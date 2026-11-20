# Token bucket rate limiting

The first rate limiter most engineers write is a counter: allow 100 requests per minute, reset the count every 60 seconds. It works until a client sends 100 requests at 12:00:59 and another 100 at 12:01:00. Your "100 per minute" limit just admitted 200 requests in two seconds.

The token bucket fixes this by modelling what you actually want. Clients get a steady average rate, and they are allowed short bursts. It is simple enough to write in 15 lines. It is also easy to get subtly wrong. This post covers the mental model, a simulation with a trace you can reproduce, two implementations (in-process and Redis), and the mistakes that tend to show up in production.

## The mental model

Picture a bucket that holds tokens.

- Tokens drip into the bucket at a constant **rate** `r` (say, 10 per second).
- The bucket has a maximum **capacity** `b` (say, 50). Once it is full, extra tokens are discarded.
- Each request must remove tokens (usually 1) from the bucket. If enough tokens are there, the request is admitted. If not, it is rejected or delayed.

That's the whole algorithm. Two properties fall out of it.

**Bursts are allowed.** A client that has been idle has a full bucket. It can send `b` requests back to back, and all of them are admitted immediately.

**The average rate is enforced.** Once the bucket is empty, the client can only proceed as fast as tokens arrive, which is `r` per second. Over any window of length `T`, the number of admitted requests is at most:

```
b + r × T
```

The `b` is the initial burst, and the `r × T` is what the drip supplies. As `T` grows, `b` becomes negligible and the admitted rate converges to `r`. This one inequality is worth memorising. It tells you exactly how much traffic your downstream can see in any window.

Compare this with a fixed window counter, which can admit up to twice its limit across a window boundary. The token bucket has no boundaries, so it has no such seam.

## You don't need a timer

A beginner's instinct is to run a background thread that adds a token every `1/r` seconds. Don't. It costs a thread (or timer) per bucket, and it drifts under load.

Instead, refill **lazily**. Store two numbers per bucket: the token count and the timestamp of the last update. When a request arrives, compute how many tokens *would* have been added since then and apply them in one step:

```
tokens = min(capacity, tokens + (now - last) × rate)
last   = now
```

A bucket that nobody touches costs nothing. This lazy refill is the core trick of every production implementation, including the Redis one below.

## A simulation you can run

Here is a minimal in-process implementation. Note that the clock is injected. This matters for testing, and it is what makes the simulation below deterministic.

```python
import threading
import time

class TokenBucket:
    def __init__(self, capacity, rate, clock=time.monotonic):
        self.capacity = capacity
        self.rate = rate              # tokens per second
        self.clock = clock
        self.tokens = float(capacity) # start full
        self.last = clock()
        self.lock = threading.Lock()

    def allow(self, cost=1.0):
        with self.lock:
            now = self.clock()
            elapsed = max(0.0, now - self.last)
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens >= cost:
                self.tokens -= cost
                return True
            return False
```

Now drive it with a fake clock. The bucket has capacity 5 and refills at 1 token per second. Traffic arrives in clumps:

```python
now = 0.0
bucket = TokenBucket(capacity=5, rate=1.0, clock=lambda: now)

events = [(0.0, 8), (1.0, 1), (2.0, 1), (2.5, 1), (3.0, 1), (10.0, 6)]
for t, n in events:
    now = t
    results = ["ok" if bucket.allow() else "x" for _ in range(n)]
    print(f"t={t:4.1f}  {' '.join(results)}")
```

Output:

```
t= 0.0  ok ok ok ok ok x x x
t= 1.0  ok
t= 2.0  ok
t= 2.5  x
t= 3.0  ok
t=10.0  ok ok ok ok ok x
```

Here is what happened at each step.

| Time | Event | Tokens before | Outcome | Tokens after |
|------|-------|---------------|---------|--------------|
| 0.0 | 8 requests | 5 | 5 admitted, 3 rejected | 0 |
| 1.0 | 1 request | 1 | admitted | 0 |
| 2.0 | 1 request | 1 | admitted | 0 |
| 2.5 | 1 request | 0.5 | rejected | 0.5 |
| 3.0 | 1 request | 1.0 | admitted | 0 |
| 10.0 | 6 requests | 5 (capped; 7 would have accrued) | 5 admitted, 1 rejected | 0 |

Look at three moments.

At `t=0`, the full bucket absorbs a burst of five, then the sixth request meets an empty bucket and is rejected. That is the burst allowance at work.

At `t=2.5`, the client tries too early. Half a token exists, and the request needs a whole one. Fractional tokens are normal. Don't round them away.

At `t=10`, the client was idle for seven seconds, which would have accrued seven tokens. The cap discards two of them, so only five requests get through. This is why the bucket doesn't let a quiet client "save up" unlimited credit.

Check the bound: 13 requests were admitted over 10 seconds, and `b + r×T = 5 + 10 = 15`. The inequality holds.

## Choosing the two numbers

`rate` is your sustained throughput budget: what your backend can handle per client, indefinitely.

`capacity` is how spiky you are willing to let a client be. Two rules of thumb:

- **Capacity of 1** gives you a strict pacer: one request per `1/r` seconds, no bursting at all.
- **Capacity of `r × N`** lets a client send `N` seconds' worth of traffic at once. Page loads and batch jobs are naturally bursty, so a capacity of one to ten seconds' worth is common for user-facing APIs.

Pick capacity by asking what your downstream can survive as a single instantaneous spike, not by what feels generous. This is where most misconfiguration starts.

## Distributed version: Redis and Lua

An in-process bucket limits one process. If you run 20 instances behind a load balancer, each with its own bucket, a client can get up to 20 times the intended rate. For a shared limit you need shared state, and the read-modify-write must be atomic. A Lua script in Redis gives you that, because Redis runs a script without interleaving other commands.

```lua
-- KEYS[1] = bucket key
-- ARGV[1] = capacity, ARGV[2] = rate (tokens/sec), ARGV[3] = cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call('TIME')
local now = t[1] + t[2] / 1e6

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)

local allowed = 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- An idle bucket is indistinguishable from a full one, so let it expire.
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000) * 2)

return allowed
```

Several choices here are deliberate, and each one maps to a mistake in the next section:

- The script reads time from Redis (`TIME`), not from the application server, so all clients agree on one clock.
- The whole refill-check-deduct sequence is one atomic unit.
- The key expires after twice the time it takes to refill from empty. After that, the bucket would be full anyway, so deleting it loses nothing.

## Mistakes that bite in production

### 1. Check-then-act races

The most common bug looks like this:

```python
tokens = redis.get(key)          # read
if tokens >= 1:
    redis.set(key, tokens - 1)   # write
```

Two concurrent requests both read `1`, both pass the check, and both deduct. Under load, your limit leaks. The fix is atomicity: a lock in-process, a Lua script or transaction in Redis. `DECR` followed by a check works for a simple counter, but it doesn't handle lazy refill, which is why the script above exists.

### 2. Using the wall clock

`time.time()` can jump backwards (NTP corrections, VM migrations, leap-second smearing) and forwards (manual changes, resumed laptops). A backwards jump produces a negative `elapsed` and can drain tokens. A big forward jump refills the bucket instantly. Use a monotonic clock in-process, and clamp elapsed time at zero as the code above does. In a distributed setup, use a single time source such as Redis `TIME`, because monotonic clocks from different machines aren't comparable.

### 3. Forgetting the cap

If you write `tokens += elapsed × rate` and forget the `min(capacity, …)`, the bucket grows without bound while a client is idle. After a weekend of silence they can send a million requests at once. That bug passes every unit test that doesn't wait long enough, so write a test that advances the fake clock by a day and asserts the burst is still `capacity`.

### 4. Capacity set larger than downstream can handle

A limit of 10 requests per second with a capacity of 600 means one client can send 600 requests in a single instant. Averages are a promise about the long run, but your database only experiences the instant. And the spikes add up. If 1,000 clients each have a burst of 50, a coordinated reconnect after an outage hands you 50,000 requests at once. Size capacity against the worst case across clients, not for a single one.

### 5. New buckets start full

A new key is created with a full bucket, which is usually the right behaviour. But consider a deploy that resets state, or a Redis failover that loses keys. Every client suddenly has a full bucket at the same moment, and every client uses it. If this matters for you, persist state, or start new buckets partially full.

### 6. Unbounded key growth

One bucket per user, IP or API key means one Redis key per identity. Attackers (or just crawlers) can create millions of identities. Without a TTL, those keys live forever and your rate limiter becomes your memory problem. Always set an expiry, and remember that expiry is safe because an idle bucket is equivalent to a full one.

### 7. No policy for limiter failure

When Redis is down or slow, what happens to requests? Failing **open** (allow everything) keeps your product up but removes protection exactly when you may be under stress. Failing **closed** (reject everything) protects the backend but converts a limiter outage into a full outage. Neither is universally right. Decide on purpose, put a short timeout on the limiter call, and consider a local in-process fallback bucket as a degraded mode.

### 8. Rejecting without telling the client

A bare `429` invites clients to retry immediately, which makes the load worse. You know exactly when the next token arrives, so say so:

```
retry_after = (cost - tokens) / rate    # seconds
```

Return it in a `Retry-After` header. On the client side, back off with jitter. Without jitter, every rejected client retries in lockstep and recreates the spike you were trying to flatten.

### 9. Keying on the wrong identity

Limiting by IP address punishes everyone behind a corporate NAT or mobile carrier gateway. Behind a proxy, if you trust `X-Forwarded-For` blindly, attackers can rotate the header and get a fresh bucket per request. Key on something authenticated where you can (API key, user ID), and fall back to IP only for unauthenticated traffic. Take the client address from the proxy hop you control.

### 10. Cost greater than capacity

If you charge different costs per endpoint (a search costs 10 tokens, a read costs 1) and some cost exceeds `capacity`, that request can never succeed, no matter how long the client waits. Validate at configuration time that `cost ≤ capacity` for every route.

## Token bucket versus its neighbours

- **Fixed window counter:** simplest, but allows double bursts at window edges.
- **Sliding window log:** precise, but stores a timestamp per request, so memory grows with traffic.
- **Leaky bucket:** a close cousin that smooths traffic into a constant output rate. It is the right choice when the downstream can't tolerate any burst. Token bucket is the right choice when you want to be generous to bursty-but-well-behaved clients.

For most API rate limiting, the token bucket's two intuitive parameters and constant-size state (two numbers per key) make it the default.

## Takeaways

1. A token bucket enforces an average rate `r` while permitting bursts up to `b`. Over any window `T`, at most `b + r×T` requests get through.
2. Refill lazily from timestamps. You never need a timer.
3. Make the read-refill-deduct sequence atomic, and use a trustworthy, monotonic time source.
4. Cap the bucket, expire idle keys, and size capacity against what your downstream can absorb in one instant.
5. Decide your failure mode in advance, and return `Retry-After` so well-behaved clients can cooperate.

If you take one thing away, make it this: write the fake-clock test first. Once time is something you can control, every behaviour in this post, including the cap, the refill, the burst and the clock skew, becomes a five-line test instead of a production incident.
