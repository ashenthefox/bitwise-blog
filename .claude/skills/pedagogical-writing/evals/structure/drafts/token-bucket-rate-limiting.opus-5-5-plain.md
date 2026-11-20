# Token bucket rate limiting

Sooner or later, something will call your service too often. It might be a buggy client stuck in a retry loop, a customer's batch job that launches ten thousand requests at midnight, or a scraper. You need a rule that says "this caller gets this much, and no more," and you need it to be cheap, fair, and predictable.

The token bucket is the most common answer, and for good reason. It enforces an **average rate** while still allowing **short bursts**, which matches how real clients behave. Page loads fan out into a dozen API calls, and mobile apps sync everything at once when they come back online. A limiter that rejects the eleventh request in a second, even when the client has been idle for an hour, causes more problems than it prevents.

This post covers how the algorithm works, includes a simulation you can play with, gives two implementations (in-process and Redis), and lists the mistakes that tend to show up only after you ship.

## The model

A token bucket has two parameters:

- **Capacity (`b`)**: the maximum number of tokens the bucket can hold.
- **Refill rate (`r`)**: how many tokens are added per second.

The rules are:

1. Tokens drip into the bucket at rate `r`. When the bucket is full, extra tokens are discarded.
2. Each request needs one token, or more if requests have different costs.
3. If enough tokens are available, remove them and allow the request. If not, reject it, or make it wait.

An idle client builds up to `b` tokens of credit, so it can burst up to `b` requests at once. After that, it can only go as fast as the refill rate. Over a long period, the accepted rate converges to `r`.

The guarantee can be stated exactly: **in any time window of length `T`, at most `b + r·T` requests are accepted.** The `b` term is the burst allowance, and the `r·T` term is the sustained rate. Choosing parameters comes down to choosing those two numbers.

## Walking through it

Take `r = 2` tokens/second and `b = 5`. The bucket starts full.

| Time (s) | Tokens before | Event | Result | Tokens after |
|---|---|---|---|---|
| 0.00 | 5.0 | 7 requests arrive at once | 5 accepted, 2 rejected | 0.0 |
| 1.00 | 2.0 | 3 requests | 2 accepted, 1 rejected | 0.0 |
| 1.25 | 0.5 | 1 request | rejected (retry in 0.25 s) | 0.5 |
| 4.00 | 5.0 (capped from 6.0) | 1 request | accepted | 4.0 |

Two details in this trace matter later:

- At t=1.25 the bucket holds half a token. That fraction is real state. If you discard it, your limiter becomes stricter than you configured.
- Between t=1.25 and t=4.00 nothing refilled the bucket in the background. The 2.75 seconds of elapsed time were turned into tokens at the moment the next request arrived. This is called **lazy refill**, and it is the key to a cheap implementation.

## Live simulation

The widget below runs a real token bucket in your browser. Requests arrive randomly at the "arrival rate." The blue line shows the token level, green ticks are accepted requests, and red ticks are rejected ones. Try these:

- Set arrival rate below refill rate. Almost everything is accepted, and the bucket stays near full.
- Set arrival rate above refill rate. The bucket drains and stays near zero. The accepted rate settles at the refill rate, and the excess turns red.
- Let the bucket fill, then click "Send burst of 20." Up to `capacity` requests get through instantly.

<div id="tb-sim" style="font-family:system-ui,sans-serif;max-width:640px;border:1px solid #ccc;padding:12px;border-radius:8px">
  <label>Refill rate (tokens/s): <input id="tb-rate" type="range" min="1" max="20" value="5"> <span id="tb-rate-v">5</span></label><br>
  <label>Capacity: <input id="tb-cap" type="range" min="1" max="50" value="10"> <span id="tb-cap-v">10</span></label><br>
  <label>Arrival rate (req/s): <input id="tb-arr" type="range" min="0" max="40" value="4"> <span id="tb-arr-v">4</span></label><br>
  <button id="tb-burst">Send burst of 20</button>
  <canvas id="tb-canvas" width="600" height="160" style="display:block;margin-top:8px;background:#fafafa"></canvas>
  <div id="tb-stats" style="font-size:14px;margin-top:6px"></div>
</div>
<script>
(function () {
  const $ = id => document.getElementById(id);
  const c = $('tb-canvas'), g = c.getContext('2d');
  const cfg = () => ({ rate: +$('tb-rate').value, cap: +$('tb-cap').value, arr: +$('tb-arr').value });
  ['rate', 'cap', 'arr'].forEach(k => $('tb-' + k).oninput = e => $('tb-' + k + '-v').textContent = e.target.value);

  let tokens = cfg().cap, last = performance.now(), ok = 0, no = 0, fOk = 0, fNo = 0;
  const hist = [], recent = [];

  function refill(now) {
    const { rate, cap } = cfg();
    tokens = Math.min(cap, tokens + (now - last) / 1000 * rate);
    last = now;
  }
  function take(now) {
    refill(now);
    if (tokens >= 1) { tokens -= 1; ok++; fOk++; recent.push(now); }
    else { no++; fNo++; }
  }
  $('tb-burst').onclick = () => { const now = performance.now(); for (let i = 0; i < 20; i++) take(now); };

  let prev = performance.now();
  function frame(now) {
    const dt = (now - prev) / 1000; prev = now;
    let n = 0, p = 1; const L = Math.exp(-cfg().arr * dt);
    while ((p *= Math.random()) > L) n++;          // Poisson arrivals this frame
    for (let i = 0; i < n; i++) take(now);
    refill(now);
    hist.push({ t: tokens, ok: fOk, no: fNo }); fOk = fNo = 0;
    if (hist.length > c.width) hist.shift();
    while (recent.length && now - recent[0] > 5000) recent.shift();
    draw();
    requestAnimationFrame(frame);
  }
  function draw() {
    const cap = cfg().cap, h = c.height - 20;
    g.clearRect(0, 0, c.width, c.height);
    hist.forEach((s, x) => {
      if (s.ok) { g.fillStyle = '#2a2'; g.fillRect(x, h + 2, 1, 8); }
      if (s.no) { g.fillStyle = '#d22'; g.fillRect(x, h + 11, 1, 8); }
    });
    g.strokeStyle = '#26c'; g.lineWidth = 2; g.beginPath();
    hist.forEach((s, x) => { const y = h - (s.t / cap) * (h - 4); x ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    $('tb-stats').textContent =
      `tokens: ${tokens.toFixed(2)} / ${cap}  ·  accepted: ${ok}  ·  rejected: ${no}  ·  accepted rate (last 5s): ${(recent.length / 5).toFixed(1)}/s`;
  }
  requestAnimationFrame(frame);
})();
</script>

*(If your reader strips scripts, copy the block into an `.html` file and open it locally.)*

The "accepted rate (last 5s)" number is the one to watch. However high you push the arrival rate, it stays at about the refill rate. That is the average-rate guarantee.

## Implementation 1: in-process

You do not need a timer, a background thread, or a queue. You need two numbers per bucket, the current token count and the time it was last updated, and you top up the tokens whenever someone asks.

```python
import threading
import time


class TokenBucket:
    def __init__(self, rate: float, capacity: float):
        if rate <= 0 or capacity <= 0:
            raise ValueError("rate and capacity must be positive")
        self.rate = rate              # tokens per second
        self.capacity = capacity      # max burst
        self.tokens = capacity        # start full
        self.updated = time.monotonic()
        self._lock = threading.Lock()

    def try_acquire(self, cost: float = 1.0) -> tuple[bool, float]:
        """Return (allowed, retry_after_seconds)."""
        if cost > self.capacity:
            # This request can never succeed; say so instead of looping forever.
            return False, float("inf")
        with self._lock:
            now = time.monotonic()
            elapsed = now - self.updated
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.updated = now
            if self.tokens >= cost:
                self.tokens -= cost
                return True, 0.0
            return False, (cost - self.tokens) / self.rate
```

A few choices in this code are deliberate:

- **`time.monotonic()`, not `time.time()`.** Wall-clock time can jump backwards when NTP corrects it, or forwards after a VM resumes. A forward jump fills every bucket, and a backward jump produces negative elapsed time. Monotonic clocks only move forward.
- **Tokens are floats.** Fractional tokens carry over between calls.
- **The lock covers read, compute, and write together.** Without it, two threads can both read `tokens = 1`, both decide to allow, and both subtract.
- **It returns a retry hint.** `(cost - tokens) / rate` is exactly how long the caller must wait. Send it back as a `Retry-After` header.

For per-client limits, keep a dict of buckets keyed by API key, user ID, or whatever identifies the caller. Eviction is covered below.

## Implementation 2: shared across servers with Redis

If you run eight replicas behind a load balancer and each one has its own in-memory buckets, every client effectively gets eight times the limit, and the exact multiple depends on how the load balancer distributes traffic. For a global limit, the state needs to live somewhere shared.

The same algorithm works in Redis, but the read-modify-write has to be atomic. A Lua script runs atomically on the server, so use one:

```lua
-- KEYS[1] = bucket key, e.g. "rl:{api_key}"
-- ARGV[1] = rate (tokens/sec), ARGV[2] = capacity, ARGV[3] = cost
local rate     = tonumber(ARGV[1])
local capacity = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

-- Use the Redis server's clock so every app server agrees on "now".
local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1e6

local state  = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local ts     = tonumber(state[2]) or now

-- Clamp elapsed at zero in case the clock steps backwards (e.g. after failover).
tokens = math.min(capacity, tokens + math.max(0, now - ts) * rate)

local allowed, retry_after = 0, 0
if tokens >= cost then
  tokens  = tokens - cost
  allowed = 1
else
  retry_after = (cost - tokens) / rate
end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- After capacity/rate seconds idle the bucket would be full again,
-- which is identical to having no state. Let Redis delete it.
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000))

return { allowed, tostring(retry_after) }
```

Two details in this script cause real bugs when they are missed:

- **Redis converts Lua numbers to integers in replies.** If you return `retry_after` as a number, `0.25` comes back as `0`. Return it as a string.
- **The expiry is exact, not a guess.** A bucket that has been idle for `capacity / rate` seconds is full, and a full bucket behaves exactly like a missing one, because missing keys default to full. Expiring at that point loses nothing and keeps memory bounded by the number of *active* callers.

Load the script once with `SCRIPT LOAD` and call it with `EVALSHA`. The cost is one round trip per request, so if that is too much for your hot path, the next section covers the trade-offs.

## Mistakes that bite in production

### Running a timer to refill buckets

The obvious first design is a background job that adds tokens to every bucket every second. It does work proportional to the number of buckets even when nobody is calling. It also adds tokens in steps instead of smoothly, so a client can get through about twice the intended rate around each tick boundary. Lazy refill has neither problem.

### Truncating tokens to integers

If you store `tokens` as an integer and compute `int(elapsed * rate)` while still advancing `updated` to `now`, you drop the fraction on every call. A client that polls every 150 ms against a limit of 5/s earns 0.75 tokens per call, rounds down to 0, and is never served. Store floats. Alternatively, advance the timestamp only by the time you actually converted into tokens.

### Trusting the wrong clock

Wall-clock time on one machine is risky, and wall-clock time from *several* machines is worse. If each app server computes `now` itself and writes it into Redis, skew between servers turns directly into free tokens or phantom throttling. Use a monotonic clock in-process and a single authority, such as Redis `TIME`, for shared state. Always clamp elapsed time at zero.

### Non-atomic distributed updates

`GET`, compute in the app, then `SET` is a race condition. Under exactly the concurrent load you are trying to limit, many requests read the same token count and all succeed. Use a Lua script, or a transaction with `WATCH` and retries. Do not split the logic across round trips.

### Limiting per instance when you meant global

This is the replica-multiplication problem from earlier. Autoscaling makes it worse, because your effective limit grows during the traffic spikes you wanted to contain. If an approximate limit is acceptable, a common compromise is local buckets configured at `limit / replica_count`, combined with sticky routing. Decide explicitly which one you want.

### Keying on the wrong identity

Per-IP limits punish everyone behind a corporate NAT or a mobile carrier gateway, and they do almost nothing against an attacker with many IPs. Behind a proxy, every request may appear to come from the proxy's address, unless you parse `X-Forwarded-For`, and that header can be spoofed if you trust it from arbitrary sources. Limit on authenticated identity where you can, and fall back to IP only for unauthenticated endpoints.

### Unbounded bucket maps

An in-memory `dict[key, TokenBucket]` grows forever if keys come from client input. Use the same reasoning as the Redis expiry: evict any bucket idle longer than `capacity / rate`. An LRU with a size cap works too.

### Treating all requests as equal

A request that exports a million rows and a health check should not cost the same. Pass a `cost` that reflects actual load, such as rows, bytes, or estimated CPU. Make sure `cost <= capacity`, or that request can never succeed, as the in-process implementation handles.

### Rejecting without telling the client when to retry

A bare `429` causes clients to retry immediately, which uses up the refill as it arrives and keeps them throttled indefinitely. Return `Retry-After` with the computed wait, and encourage clients to use jittered backoff. Your rate limiter only works well if the clients respond sensibly to it.

### A burst capacity so large it defeats the limit

With `r = 10/s` and `b = 10,000`, a client can send 10,000 requests in one second after a quiet period. Go back to the bound `b + r·T`. If your downstream service cannot handle `b` requests at once, then `b` is too big. A starting point is a few seconds' worth of `r`, which you can then adjust based on real traffic.

### Deciding fail-open vs. fail-closed during an incident

When Redis is unreachable, does every request get through, or does every request fail? Make that decision before it happens. Most public APIs fail open, with a local fallback bucket as a safety net. Limits that protect something fragile, or that cost money, such as SMS sending, usually fail closed.

## Choosing parameters

Start from what the protected resource can handle, not from round numbers:

- **`r`**: the sustained throughput you are willing to give one caller. That is usually total capacity divided by expected concurrent heavy callers, with headroom.
- **`b`**: the largest burst a legitimate client produces. Measure it, for example as requests per page load or per sync, and add a margin.

Log every rejection with its key and the bucket state. In the first week you will find out which limits are too tight for real users and which callers actually need limiting.

## Wrapping up

A token bucket stores two numbers per caller, does a little arithmetic per request, and gives you a precise guarantee: never more than `b + r·T` requests in any window `T`. Most of the difficulty is not in the algorithm. It is in clocks, atomicity, keying, memory, and how clients react to rejections. Use lazy refill with a monotonic clock, keep shared state atomic, expire idle buckets, and always tell clients when to come back.
