# Token bucket rate limiting

Every API eventually meets a client that sends too much: a buggy retry loop, a scraper, a customer who just discovered `for` loops. A rate limiter is the component that says "enough" before your database says it for you.

There are several algorithms for this. The token bucket is the one you will see most often, because it matches how real traffic behaves: mostly steady, sometimes bursty. This post explains how it works, lets you play with a simulation, shows implementations in memory and in Redis, and covers the mistakes that tend to show up only after you ship.

## The idea in one paragraph

Picture a bucket that holds tokens. Each request must take one token to proceed. If the bucket is empty, the request is rejected (or delayed). Meanwhile, tokens drip into the bucket at a constant rate, but the bucket has a maximum capacity, so extra tokens spill over and are lost.

That's the whole algorithm. Two parameters define it:

- **Refill rate** (`r`): tokens added per second. This is your long-term average rate.
- **Capacity** (`b`, the "burst size"): the most tokens the bucket can hold. This is how large a burst you tolerate.

The consequence is the interesting part. A client that has been idle has a full bucket, so it can send `b` requests instantly. After that, it can only send at rate `r`, because that's how fast tokens come back. Over any window of length `T`, the maximum number of admitted requests is:

```
max_requests(T) ≤ b + r × T
```

So the bucket admits bursts, but the average rate converges to `r`. That single inequality is worth memorizing, because it is the contract you are offering clients.

## A live simulation (in your head, or in a terminal)

I can't embed an interactive widget in Markdown, so here is a simulation you can run yourself. It prints a timeline for a bucket with `r = 2` tokens/sec and `b = 5`, hit by a burst followed by a steady stream.

```python
# simulate.py
r, b = 2.0, 5.0          # refill rate, capacity
tokens, last = b, 0.0    # start full

# (time in seconds) at which requests arrive
arrivals = [0.0]*6 + [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.5, 3.0, 3.5, 4.0, 6.0, 6.0, 6.0]

for t in arrivals:
    tokens = min(b, tokens + (t - last) * r)
    last = t
    if tokens >= 1:
        tokens -= 1
        verdict = "ALLOW"
    else:
        verdict = "DENY "
    print(f"t={t:4.1f}  tokens_after={tokens:4.2f}  {verdict}")
```

Run it with `python3 simulate.py` and you'll see this shape:

```
t= 0.0  tokens_after=4.00  ALLOW
t= 0.0  tokens_after=3.00  ALLOW
t= 0.0  tokens_after=2.00  ALLOW
t= 0.0  tokens_after=1.00  ALLOW
t= 0.0  tokens_after=0.00  ALLOW
t= 0.0  tokens_after=0.00  DENY     <- burst of 5 admitted, 6th rejected
t= 1.0  tokens_after=1.00  ALLOW    <- 2 tokens refilled, 1 spent
t= 1.2  tokens_after=0.40  ALLOW
t= 1.4  tokens_after=0.20  DENY
...
```

Three things to notice:

1. **The burst.** Five requests at `t=0` all pass because the bucket started full. The sixth fails.
2. **Steady state.** After the burst, the client is throttled to roughly 2 requests per second, no matter how fast it tries.
3. **Recovery.** After a quiet period (`t=4.0` to `t=6.0`), the bucket refills and the next burst is admitted again, up to `b`.

Try changing `b` to 1. The limiter now behaves like a strict "one request every 0.5 seconds" gate, with no burst tolerance. Try a huge `b` with a tiny `r`: the client gets a big one-time allowance and then crawls. The two knobs are independent, and that independence is the main reason to pick this algorithm.

## You don't need a timer

A common first instinct is to run a background job that adds tokens every second. Don't. It costs a timer per bucket, which is hopeless when you have a million API keys.

Instead, compute the refill lazily. Store only two numbers per bucket: the current token count and the timestamp of the last update. When a request arrives, calculate how many tokens *would* have been added since then:

```
tokens = min(capacity, tokens + (now - last_update) × rate)
```

This makes each bucket O(1) in space and time, and an idle bucket costs nothing but its two numbers. The simulation above already does this.

## Implementation 1: in-memory, single process

Here's a clean version in Python. It's thread-safe and takes the clock as a parameter so you can test it.

```python
import threading
import time

class TokenBucket:
    def __init__(self, rate: float, capacity: float, clock=time.monotonic):
        if rate <= 0 or capacity < 1:
            raise ValueError("rate must be > 0 and capacity >= 1")
        self.rate = rate
        self.capacity = capacity
        self._clock = clock
        self._tokens = capacity
        self._last = clock()
        self._lock = threading.Lock()

    def allow(self, cost: float = 1.0) -> bool:
        with self._lock:
            now = self._clock()
            elapsed = now - self._last
            self._last = now
            self._tokens = min(self.capacity, self._tokens + elapsed * self.rate)
            if self._tokens >= cost:
                self._tokens -= cost
                return True
            return False

    def retry_after(self, cost: float = 1.0) -> float:
        """Seconds until `cost` tokens will be available."""
        with self._lock:
            missing = cost - self._tokens
            return max(0.0, missing / self.rate)
```

Notes on the choices:

- **`time.monotonic`, not `time.time`.** Wall clocks jump (NTP corrections, DST, a sysadmin). A backwards jump would produce a negative `elapsed` and silently remove tokens. Monotonic clocks only move forward.
- **A `cost` parameter.** Not every request is equal. An expensive search endpoint might cost 10 tokens while a health check costs 0.1. Weighted costs are nearly free to support and very useful later.
- **`retry_after`.** Rejecting a request is only half the job; telling the client when to come back lets well-behaved clients back off precisely.

To use it per client, keep a dictionary from API key to bucket:

```python
buckets: dict[str, TokenBucket] = {}
buckets_lock = threading.Lock()

def check(api_key: str) -> bool:
    with buckets_lock:
        bucket = buckets.get(api_key)
        if bucket is None:
            bucket = buckets[api_key] = TokenBucket(rate=10, capacity=20)
    return bucket.allow()
```

This works for one process. The moment you run two instances behind a load balancer, each has its own buckets, and your effective limit silently doubles. For that you need shared state.

## Implementation 2: Redis with a Lua script

Redis is the usual shared store. The trap here is the read-modify-write race: if two app servers each `GET` the bucket, compute, and `SET` it back, they can both spend the same token. You need the whole operation to be atomic. A Lua script runs atomically inside Redis:

```lua
-- KEYS[1] = bucket key
-- ARGV[1] = rate (tokens/sec), ARGV[2] = capacity, ARGV[3] = cost
local rate     = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- Use Redis's own clock so app servers can't disagree
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1e6

local data   = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts     = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now
end

tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- Expire idle buckets: time to refill from empty, plus slack
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) * 2)

return { allowed, tostring(tokens) }
```

And the caller, using `redis-py`:

```python
import redis

r = redis.Redis()
script = r.register_script(open("token_bucket.lua").read())

def allow(api_key: str, rate=10, capacity=20, cost=1) -> bool:
    allowed, _ = script(keys=[f"rl:{api_key}"], args=[rate, capacity, cost])
    return allowed == 1
```

Several details here matter:

- **`redis.call('TIME')`** keeps the clock in one place. If you pass `now` from the app servers instead, clock skew between machines leads to inconsistent refills.
- **`max(0, now - ts)`** guards against the clock stepping backwards.
- **The `EXPIRE`** is what keeps memory bounded. Without it, every API key you've ever seen lives in Redis forever. Once a bucket has been idle long enough to be full again, deleting it is lossless, because a missing key is treated as a full bucket.
- **Return the token count as a string.** Lua numbers are converted to integers when returned to Redis clients, so fractional values get truncated. Stringify them if you want to report remaining tokens.

One more note on Redis versions: on older setups, scripts that call `TIME` and then write were restricted under verbatim script replication. Modern Redis (5+) replicates script effects by default, so this is fine, but check your version if you are running something old.

## Mistakes that bite in production

I've seen most of these in real systems. They tend to work perfectly in testing and fail under load or in odd conditions.

### 1. Choosing capacity without thinking about the contract

`b` is not a tuning detail; it's the burst you promise to absorb downstream. If your backend can handle 100 requests per second sustained and 500 in a spike, then `b` across *all clients combined* shouldn't exceed what that spike allows. A per-client capacity of 100 across 1,000 clients is a potential 100,000-request spike, all legitimately admitted at once. Compute the worst case: `clients × b`.

### 2. Using the wall clock

Covered above, but it's worth repeating because the failure is nasty. A backwards clock step gives negative elapsed time. Depending on your code, that either drains tokens or, with a sloppy `abs()`, grants a free refill. Use a monotonic clock locally, and a single authoritative clock (like Redis `TIME`) when distributed.

### 3. Forgetting to cap the refill

If you write `tokens + elapsed * rate` and forget the `min(capacity, ...)`, an idle client accumulates unlimited tokens over a weekend and then sends a million requests on Monday. The cap is not optional. It's half of the algorithm.

### 4. Non-atomic updates

The check-then-set race is the classic one. In a single process it means a missing lock. In a distributed setup it means a Redis `GET` followed by a `SET`. Under low traffic you never see it; under high concurrency on a single hot key, clients exceed their limit by a wide margin. Use a lock, a Lua script, or an atomic compare-and-set.

### 5. Floating point drift and tiny refills

With fractional tokens, comparisons like `tokens >= 1` can fail by `0.9999999` after many operations, so a request that "should" pass is denied. Two common fixes: compare with a small epsilon, or store tokens as integers in a smaller unit (for example, millitokens), and compute refills with integer math. The integer approach also makes behavior deterministic across languages.

### 6. Keying on the wrong identity

If you key on IP address, an entire office or mobile carrier behind one NAT shares a bucket, and one noisy user locks out everyone. If you key on an unauthenticated header, attackers just rotate its value and get a fresh full bucket every time. Prefer authenticated identity (API key, user ID) where you can, and apply a coarser IP-level limit only as a backstop. Also remember that behind a proxy, the IP you see may be the proxy's. Read the forwarded header only from trusted hops.

### 7. Unbounded bucket storage

The in-memory dictionary above leaks: every new key adds a bucket that is never removed. Attackers can exploit this by sending requests with millions of distinct keys. Evict idle buckets (a periodic sweep, or an LRU with a size cap). In Redis, the TTL does this for you.

### 8. Failing closed, or failing open, by accident

What happens when Redis is down or slow? If your limiter throws an exception, the request may fail with a 500, so a limiter outage becomes a full API outage. If you swallow the error and allow everything, you've silently removed protection exactly when the system is stressed. Decide deliberately. A common choice is to fail open with a short timeout, alert loudly, and fall back to a coarse local in-memory limiter so you're degraded rather than naked.

### 9. Poor rejection responses

Return HTTP `429 Too Many Requests` with a `Retry-After` header computed from the bucket (`retry_after()` above). Without it, clients guess, and the typical guess is "retry immediately," which makes the overload worse. Adding jitter on the client side helps further, since a hundred clients all told "retry in 2 seconds" will return in the same instant.

### 10. Not testing with a fake clock

Rate limiters are time-dependent code, and tests that call `sleep` are slow and flaky. Inject the clock, as in the Python class above, and write tests that advance time explicitly:

```python
def test_burst_then_refill():
    now = [0.0]
    bucket = TokenBucket(rate=2, capacity=5, clock=lambda: now[0])

    assert all(bucket.allow() for _ in range(5))   # burst admitted
    assert not bucket.allow()                       # 6th denied

    now[0] += 1.0                                   # 2 tokens refill
    assert bucket.allow()
    assert bucket.allow()
    assert not bucket.allow()
```

Add a test for the long idle period to prove the cap works: advance an hour and assert that you can still only spend `capacity` tokens.

## Token bucket versus its neighbors

A quick orientation so you know when to reach for something else:

- **Fixed window counter** ("100 requests per minute, reset on the minute"): simplest, but allows double the limit across a window boundary (100 at 12:00:59, 100 more at 12:01:00).
- **Sliding window log or counter**: more precise about "requests in the last N seconds," at the cost of more memory or approximation.
- **Leaky bucket**: similar to a token bucket but smooths output to a constant rate rather than permitting bursts. Use it when the downstream really cannot tolerate bursts.

The token bucket wins when you want a simple, constant-memory limiter that is generous to well-behaved bursty clients. That describes most public APIs.

## Choosing your numbers

A practical way to set the parameters:

1. Pick the **sustained rate** `r` from what you can afford per client over a minute or an hour.
2. Pick the **burst** `b` from how clients really behave. A page load that fires 15 parallel requests wants `b ≥ 15`. Look at your logs for the largest legitimate short spike.
3. Check the worst case: `clients_active × b` should not overwhelm your backend.
4. Ship with metrics: allowed count, denied count, and the distribution of remaining tokens at decision time. If most denials come from a few keys, that's abuse; if they come from many keys at once, your limits are probably too tight.

Start in observe-only mode (compute the decision, log it, but allow the request) for a week. Real traffic will surprise you, and it's much better to discover that your `b` is too small from a log line than from an angry customer.

## Takeaways

- A token bucket has two knobs: `r` for the average rate and `b` for the burst size. Over any window `T`, at most `b + r×T` requests get through.
- Refill lazily from a timestamp. No timers, two numbers per bucket.
- Use a monotonic clock, cap the refill, and make the update atomic.
- Go distributed with a Redis Lua script, and let TTLs clean up idle buckets.
- Decide what happens when the limiter itself fails, and give rejected clients a `Retry-After`.

The algorithm fits in about fifteen lines. The production work is all in the edges: clocks, concurrency, identity, and failure modes. Get those right and you have a limiter that protects your backend without punishing the clients who are behaving.
