# Token bucket rate limiting

Sooner or later, every backend service needs to say "no." A partner's batch job hammers your search endpoint. A retry loop with no backoff turns one failed request into ten thousand. A scraper finds your API. Without a rate limiter, these turn into an outage.

The token bucket is the algorithm most production systems use. It is used in Nginx, Envoy, AWS API Gateway, Stripe's API, and Go's `golang.org/x/time/rate`. It fits in about fifteen lines of code. The core idea is easy to follow, but the details trip people up.

This post covers how the bucket works, gives you a simulation to play with, shows three implementations (in-process, thread-safe, and distributed), and then goes through the mistakes that cause trouble in production.

## The problem with counting per window

The first rate limiter most people write is a fixed window counter: "100 requests per minute." You keep a counter per client, reset it at the top of each minute, and reject once it reaches 100.

It has two problems.

- **The boundary burst.** A client sends 100 requests at 12:00:59 and another 100 at 12:01:00. That is 200 requests in one second, and all of them are allowed.
- **No burst control.** All 100 requests can arrive in the same millisecond. Your database sees a spike, not a rate.

What you want is a limiter that permits *some* burstiness, because real clients are bursty (a page load fires twelve API calls at once). But the burst should have a known maximum size, and the average rate should hold over any time interval you look at.

## The model

A token bucket has two parameters:

- **Capacity `b`**: the maximum number of tokens the bucket can hold. This is your burst size.
- **Refill rate `r`**: tokens added per second. This is your sustained average rate.

The rules:

1. The bucket starts full.
2. Tokens are added continuously at rate `r`, but the bucket never holds more than `b`.
3. Each request costs one token (or more, if some requests are more expensive than others).
4. If enough tokens are available, remove them and allow the request. If not, reject it.

These rules give you a guarantee. **Over any time interval of length `T`, the number of admitted requests is at most `b + r·T`.**

- A client that has been idle can spend `b` tokens at once.
- After that, the client gets tokens only as fast as they refill.
- Over long intervals, the `b` term becomes insignificant and the admitted rate converges to `r`.

## The key trick: lazy refill

You might picture a background thread adding a token every `1/r` seconds. Don't build that. With a million client keys, you would have a million timers.

Instead, store two values per bucket: `tokens` and `last_refill_time`. When a request arrives, compute how many tokens *would have* been added since the last request, add them (capped at `b`), and then make the allow/reject decision:

```
elapsed = now - last
tokens  = min(capacity, tokens + elapsed * rate)
last    = now
```

An idle bucket costs nothing and does no work. Its state only changes when someone uses it.

## A live simulation

The widget below runs a real token bucket in your browser. Try the following:

1. Click **Send 10**. Exactly `capacity` requests get through.
2. Watch the bar refill.
3. Turn on the steady 4 req/s stream with a refill rate of 2. About half the requests are allowed. The burst capacity runs out, and then the bucket admits requests at the refill rate.

<div id="tb-sim" style="font-family:system-ui;border:1px solid #ccc;padding:12px;border-radius:8px;max-width:520px">
  <div>Capacity <input id="cap" type="number" value="5" min="1" style="width:4em">
       Refill/s <input id="rate" type="number" value="2" min="0.1" step="0.1" style="width:4em"></div>
  <div style="margin:8px 0;background:#eee;height:22px;border-radius:4px">
    <div id="bar" style="height:100%;background:#3a7;border-radius:4px;width:100%"></div></div>
  <div id="stat">tokens 5.00 · allowed 0 · denied 0</div>
  <button id="one">Send 1</button> <button id="burst">Send 10</button>
  <label><input id="flood" type="checkbox"> steady 4 req/s</label>
  <pre id="log" style="height:8em;overflow:auto;background:#f7f7f7;margin-top:8px"></pre>
</div>
<script>
(() => {
  const $ = id => document.getElementById(id);
  let tokens = 5, last = performance.now(), ok = 0, no = 0;
  const t0 = last, cap = () => +$('cap').value, rate = () => +$('rate').value;
  function refill(now) {
    tokens = Math.min(cap(), tokens + (now - last) / 1000 * rate());
    last = now;
  }
  function request() {
    const now = performance.now(); refill(now);
    const allowed = tokens >= 1;
    if (allowed) { tokens -= 1; ok++; } else { no++; }
    $('log').textContent =
      `t=${((now - t0) / 1000).toFixed(2)}s ${allowed ? 'ALLOW' : 'DENY '} tokens=${tokens.toFixed(2)}\n`
      + $('log').textContent;
  }
  $('one').onclick = request;
  $('burst').onclick = () => { for (let i = 0; i < 10; i++) request(); };
  setInterval(() => { if ($('flood').checked) request(); }, 250);
  (function draw() {
    refill(performance.now());
    $('bar').style.width = (100 * tokens / cap()) + '%';
    $('stat').textContent = `tokens ${tokens.toFixed(2)} · allowed ${ok} · denied ${no}`;
    requestAnimationFrame(draw);
  })();
})();
</script>

If your blog renderer strips scripts, here is the same experiment as a deterministic script. It uses capacity 5 and a refill rate of 2/s. The traffic is a burst of 8 at `t=0`, then 4 req/s for three seconds, then silence, then a burst of 6 at `t=6`:

```python
class TokenBucket:
    def __init__(self, capacity, refill_rate, now=0.0):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = capacity
        self.last = now

    def allow(self, now, cost=1):
        elapsed = now - self.last
        self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
        self.last = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False

bucket = TokenBucket(capacity=5, refill_rate=2)
arrivals = [0.0] * 8 + [0.25 * i for i in range(1, 13)] + [6.0] * 6
for t in arrivals:
    ok = bucket.allow(t)
    print(f"t={t:4.2f}s  {'ALLOW' if ok else 'DENY '}  tokens={bucket.tokens:.2f}")
```

Abridged output:

```
t=0.00s  ALLOW  tokens=4.00     ← burst: first 5 pass
...
t=0.00s  ALLOW  tokens=0.00
t=0.00s  DENY   tokens=0.00     ← requests 6–8 rejected
t=0.25s  DENY   tokens=0.50
t=0.50s  ALLOW  tokens=0.00     ← now exactly every other request passes
t=0.75s  DENY   tokens=0.50
...
t=3.00s  ALLOW  tokens=0.00
t=6.00s  ALLOW  tokens=4.00     ← 3 idle seconds refilled 6 tokens, capped at 5
...
t=6.00s  DENY   tokens=0.00
```

Here is what the output shows:

- **First three seconds:** 11 requests were admitted. That is exactly `b + r·T = 5 + 2·3`, so the bound is tight.
- **During the 4 req/s stream:** the bucket admitted 2 req/s, which is the refill rate.
- **During the idle gap:** the bucket refilled to 5 and stopped there. It did not store up 6 tokens. Idle time stops counting once the bucket is full.

## Implementation 1: in-process and thread-safe

In a real server, many threads call `allow` at the same time, and the read-modify-write must be atomic. Two other details matter: use a monotonic clock, and compute how long the caller should wait so you can send a `Retry-After` header.

```python
import threading, time

class TokenBucket:
    def __init__(self, capacity: float, refill_rate: float):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = capacity
        self.last = time.monotonic()
        self.lock = threading.Lock()

    def try_acquire(self, cost: float = 1.0) -> tuple[bool, float]:
        """Returns (allowed, seconds_until_retry)."""
        if cost > self.capacity:
            raise ValueError("cost exceeds capacity; this request can never succeed")
        with self.lock:
            now = time.monotonic()
            elapsed = max(0.0, now - self.last)
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
            self.last = now
            if self.tokens >= cost:
                self.tokens -= cost
                return True, 0.0
            return False, (cost - self.tokens) / self.refill_rate
```

For per-client limits, keep a dictionary of buckets keyed by API key. Evict entries that have been idle longer than `capacity / refill_rate`; after that long, the bucket would be full anyway, so deleting it and creating a fresh one later gives the same result.

This version is enough for a single process. It breaks as soon as you run more than one replica.

## Implementation 2: distributed, in Redis

With N app servers behind a load balancer, the bucket state has to live somewhere shared. Redis is the usual choice. The refill and the check must run as **one atomic operation**, and a Lua script provides that:

```lua
-- KEYS[1] = bucket key; ARGV = capacity, refill_per_sec, cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call('TIME')                       -- one clock for every client
local now = tonumber(t[1]) + tonumber(t[2]) / 1e6

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)

local allowed, retry_after = 0, 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
else
  retry_after = (cost - tokens) / rate
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate) + 1)
return { allowed, tostring(tokens), tostring(retry_after) }
```

Three details in this script matter:

- **`redis.call('TIME')`** reads the clock on the Redis server instead of trusting each app server's clock.
- **`tostring`** is needed because Redis truncates Lua numbers to integers when it returns them. Without it, a retry-after of 0.4 seconds comes back as 0.
- **`EXPIRE`** sets a TTL equal to the time it takes to refill the bucket. Idle keys clean themselves up, and the result is still correct, because a missing key is treated as a full bucket.

Load the script once with `SCRIPT LOAD` and call it with `EVALSHA` so you aren't sending the script text on every request.

## The mistakes that bite in production

### 1. Using the wall clock

`time.time()` and `Date.now()` can jump. When NTP steps the clock backwards, `elapsed` goes negative and the bucket *loses* tokens. When it steps forward, every client gets a free full bucket.

Use a monotonic clock in-process, as `time.monotonic()` does above. Also clamp `elapsed` with `max(0, …)` anyway, because in the distributed case you still depend on a wall clock (Redis `TIME`).

### 2. Splitting the read and the write

```python
tokens = redis.get(key)   # two servers read 1 token...
if tokens >= 1:
    redis.set(key, tokens - 1)   # ...and both admit the request
```

This race lets through bursts larger than the capacity, and only under real concurrency. That means it passes every test you run on your laptop. The fix is to run the whole operation inside the store: a Lua script, a transaction, or a single atomic command.

### 3. One bucket per replica

You configured 100 req/s and run 8 pods, each with its own in-memory bucket, so the real limit is 800 req/s. When the autoscaler adds pods, the limit rises further. If you deliberately accept local buckets to avoid a network hop, divide the configured rate by the replica count and accept that the limit is approximate.

### 4. Storing integer tokens

If you store tokens as integers and update `last` on every call, fractional refills get thrown away. Take a refill rate of 2/s and a client polling every 100 ms. Each call adds 0.2 tokens, which truncates to 0, and `last` moves forward anyway. That client never gets a token again.

Store fractional tokens. If you must use integers, keep a separate fractional remainder, or advance `last` only by the time that was actually converted into whole tokens.

### 5. Costs larger than capacity

With weighted requests (for example, a bulk export costs 50 tokens), any cost above the capacity can never be admitted. The client gets `429 Too Many Requests` with a `Retry-After` value that will never come true. Reject these requests up front with a clear error, or raise the capacity.

### 6. Keying on the wrong identity

Rate-limiting by IP address puts a whole corporate NAT, or a mobile carrier's gateway, into one bucket. Rate-limiting by `X-Forwarded-For` without checking where it came from lets an attacker pick a new identity on every request.

Use an authenticated principal (API key, user ID, or tenant) wherever you can. Read client IPs only from a header that your own edge proxy sets.

### 7. Rejecting without guidance

A bare 429 encourages clients to retry immediately, which multiplies the load you were trying to shed. Return `Retry-After`; the bucket already computed it for you. Clients should back off with jitter so that rejected clients don't all retry at the same moment.

### 8. Not deciding what happens when Redis is down

If the limiter's backing store fails, does every request fail (fail closed) or pass (fail open)? Most services should fail open, with a local fallback bucket, for ordinary API limits. They should fail closed for limits that protect something expensive or abusable, such as login attempts or SMS sends.

Make this decision deliberately. Otherwise your Redis client's default timeout behavior makes it for you.

### 9. Sizing capacity for comfort instead of for the backend

Capacity is the burst your downstream systems must absorb, *multiplied by the number of clients who might burst together*. After a deploy or a cache flush, every bucket starts full. If 10,000 clients each have a capacity of 100, your database may see a million requests at once.

Size `b` from what real clients need, such as one page load's worth of calls. Size `r` from what your backend can sustain.

## Choosing parameters

Start from two questions:

1. **What sustained rate can the protected resource handle per client?** That is `r`.
2. **What is the largest legitimate burst a well-behaved client produces?** That is `b`.

A common starting point is setting `b` to a few seconds' worth of `r`. Then log rejections per key for a week before you enforce anything. Run in shadow mode (compute the decision, record it, admit the request anyway) to find out which real clients you are about to break.

## Summary

A token bucket stores two numbers per client and refills lazily on each request. That gives you a burst allowance of `b` and a long-run rate of `r`, with no timers and constant memory per active client.

The algorithm is the easy part. The production work is in the details: use a monotonic clock, make the update atomic, put the state in one shared place, store fractional tokens, key buckets on a trustworthy identity, return a `Retry-After` that is actually correct, and choose a capacity based on what your backend can absorb.
