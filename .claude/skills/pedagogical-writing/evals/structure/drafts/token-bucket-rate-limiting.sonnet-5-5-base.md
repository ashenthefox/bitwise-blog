# Token bucket rate limiting

A rate limiter is code that decides, for each incoming request, whether to serve it or reject it, so that no client can overload your service. The hard part is choosing the rule. This post answers one question: how can a rule let a client send a burst of requests after a quiet spell, while still holding that client to an agreed average rate? The answer is the token bucket, and by the end you will be able to explain why it works and build one.

## The problem

Suppose your API promises each client an average of 5 requests per second. A client sends nothing for 10 seconds, then sends 10 requests in one instant. Should you serve them?

A strict rule such as "at least 200 milliseconds between requests" rejects 9 of the 10, even though the client used almost none of its allowance during the quiet spell. A burst is a group of requests arriving much faster than the average rate, and real clients produce them constantly: a page load fires several calls at once, and a mobile app wakes up and syncs. A good limiter tolerates bursts but never lets the long-run average exceed the promise. The token bucket does both with a single number that goes up and down.

## The idea, with real numbers

Picture a bucket that holds tokens. A token is one unit of permission, and each request must take one token out of the bucket to be served. If the bucket has no token, the request is rejected. Two settings control the bucket:

- The capacity is the most tokens the bucket can hold. We will use 10.
- The refill rate is how many tokens are added per second. We will use 5.

Tokens are added continuously at the refill rate, but the bucket never holds more than its capacity, so extra tokens are discarded. The bucket starts full. Here is what happens to one client:

At time 0 seconds the bucket holds 10 tokens. The client sends 10 requests at once. All 10 are served, because each finds a token, and the bucket is now empty. If the client sends an 11th request in that same instant, it is rejected, because no token is left.

At time 1 second, 5 tokens have been added, because the refill rate is 5 per second. The client sends 20 requests. Only 5 are served and 15 are rejected, because only 5 tokens exist.

Now the client goes quiet from time 1 until time 5. Refilling would add 5 tokens per second for 4 seconds, which is 20 tokens, but the bucket stops at 10 because of the capacity. At time 5 the client sends 20 requests. Exactly 10 are served and 10 are rejected.

That last step is the answer to the question. The quiet spell earned the client a burst of 10, because tokens piled up while it was idle. But the burst could not be larger than 10, because the capacity throws away anything beyond that. A client that sends constantly gets only the refill rate, which is 5 per second, because it uses every token as soon as the token arrives.

### The guarantee, stated exactly

In any time span of T seconds, a client can be served at most capacity plus refill rate times T requests. Here that is 10 + 5 × T. The reason is that the bucket starts with at most 10 tokens, only 5 × T more can be added in T seconds, and each served request uses one token.

This is an average rate guarantee, but not an exact one over short spans. Over 1 second the client can receive up to 15 requests, three times the average. Over 10 seconds it can receive up to 60, which is an average of 6 per second, 20 percent above the promise. Over 100 seconds the limit is 510, an average of 5.1 per second. The extra allowance is always the same fixed amount, the capacity, so as the span grows the average approaches the refill rate. The guarantee also assumes each request costs exactly one token and that the bucket never starts above capacity.

## Do not run a timer: refill when a request arrives

The obvious implementation adds tokens on a timer, say every 200 milliseconds. That is wasteful, because you would need a timer for every client, including those who never return. The better approach is lazy refill: store only two values per client, the token count and the time of the last update. When a request arrives, compute how many tokens would have been added since then.

Here is an example. At time 1.0 seconds the stored count is 0. A request arrives at time 1.3. Since the last update, 0.3 seconds have passed, and at 5 tokens per second that earns 1.5 tokens. The bucket now holds 1.5 tokens (still under the capacity of 10). The request takes one, so it is served, and 0.5 tokens remain, stored with the new time of 1.3.

Notice that the count is a fractional number. This matters. If you rounded down to whole tokens, a client sending a request every 0.1 seconds would earn 0.5 tokens between requests, see that rounded to 0, and be rejected forever, even though it is sending only 10 requests per second against a refill of 5... which is over the limit, so it would be correctly limited to about 5 per second. A client sending every 0.25 seconds is a better test. Between requests it earns 1.25 tokens, and its true rate of 4 per second is under the limit, yet rounding down would give it 1 token, then drop the 0.25 each time. In that case the rounding would keep it admitted. The failure appears at other spacings: at 0.3 seconds between requests, each gap earns 1.5 tokens, and rounding down to 1 each time throws away half a token per request, so the client is limited to roughly 3.3 requests per second instead of the 5 it is allowed. So keep the fractional part.

## A simulation you can run

This code implements the bucket with a clock that you pass in, so you can replay the example above and get the same answer every time.

```python
class TokenBucket:
    def __init__(self, capacity, rate, now):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity      # the bucket starts full
        self.last = now

    def allow(self, now, cost=1):
        elapsed = max(0, now - self.last)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last = now
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False

bucket = TokenBucket(capacity=10, rate=5, now=0)
for t in [0, 1, 2, 5]:
    admitted = sum(bucket.allow(t) for _ in range(20))
    print(f"t={t} admitted {admitted} of 20")
```

It prints:

```
t=0 admitted 10 of 20
t=1 admitted 5 of 20
t=2 admitted 5 of 20
t=5 admitted 10 of 20
```

Check it against the rule. At time 0 the full bucket gives 10. At times 1 and 2, one second of refill gives 5 each. Between times 2 and 5 three seconds would give 15 tokens, but the capacity cuts that to 10. The total is 30 requests over 5 seconds, under the bound of 10 + 5 × 5 = 35. The bound is not reached because the client sent nothing at times 3 and 4, so tokens earned in that gap beyond the capacity were discarded.

Two lines deserve their reasons. The `max(0, ...)` keeps the bucket from losing tokens if the clock ever reports an earlier time than before. The `min(self.capacity, ...)` is the line that turns an unlimited stockpile into a bounded burst.

## Implementation inside one server process

For a single process, keep a dictionary from client identifier to bucket. Two points matter.

First, use a monotonic clock, such as `time.monotonic()` in Python. A monotonic clock only moves forward at a steady pace and is unaffected by someone adjusting the system time. Wall-clock time can jump when the operating system corrects it, which distorts the elapsed time.

Second, if several threads share the bucket, protect `allow` with a lock. Without it, two threads can both read the same token count and both subtract from it, as the next section explains.

This approach holds only while one process handles all of a client's traffic. If you run several servers, each with its own dictionary, a client spread across 4 servers receives 4 times the intended rate, because each server enforces the limit on its own share. Fixing that needs a store that all servers share.

## Implementation shared across servers with Redis

Redis is an in-memory data store that many servers can talk to. The bucket's two values live there, and a small Lua script, which Redis runs as one uninterrupted step, performs the whole check.

```lua
local key      = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local data   = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(data[1])
local last   = tonumber(data[2])
if tokens == nil then
  tokens = capacity
  last = now
end

tokens = math.min(capacity, tokens + math.max(0, now - last) * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'last', now)
redis.call('EXPIRE', key, math.ceil(capacity / rate))
return allowed
```

The script reads the time from Redis itself, so every application server agrees on one clock. Calling `TIME` inside a script is permitted in Redis 5 and later. The expiry is safe because a bucket left alone for `capacity / rate` seconds (2 seconds here) would have refilled completely anyway. A deleted key is then treated as a new, full bucket, which is the same state. This keeps memory from growing with every client you have ever seen.

## Mistakes that bite in production

**Reading and writing in separate steps.** Say a bucket holds exactly 1 token, and two servers each read the count, see 1, and each decide to serve. Both then write back 0. Two requests were served on one token. This is a race condition, meaning the result depends on the timing of concurrent steps. The fix is to make the read, decision and write a single indivisible operation, called atomic, which is why the Lua script above exists. Do not build this from a separate `GET` and `SET`.

**Treating capacity as harmless.** Capacity is the largest burst you will ever let through, so choose it from what your backend can absorb at once. With a refill rate of 5 per second, a capacity of 1000 sounds generous, but it lets a rested client send 1000 requests in an instant. A common starting point is a capacity of one to a few seconds of refill, adjusted for how bursty real clients are.

**Letting each new client start full.** A new bucket starts full, so a new client can burst immediately. If clients are identified by something cheap to create, such as an IP address or an unauthenticated session token, an attacker can make fresh identifiers and take a full burst from each. The average rate guarantee holds per identifier, not per person, so limit by something that costs effort to forge, such as an authenticated account.

**Using one bucket for everyone.** A single global bucket lets one noisy client empty it and starve everyone else. Keep one bucket per client, and add a global one only as a second, outer safeguard.

**Rejecting without saying when to return.** A bare rejection makes clients retry at once, which adds load. Reply with HTTP status 429 (Too Many Requests) and a `Retry-After` header. The wait is the missing tokens divided by the refill rate. If the bucket holds 0.5 tokens and the request needs 1, the wait is 0.5 / 5 = 0.1 seconds. Because `Retry-After` carries whole seconds, you send 1, rounding up so the client does not return too early.

**Requests that cost more than the capacity.** If you charge by cost, for example 20 tokens for an expensive search, a cost larger than the capacity of 10 can never be served, no matter how long the client waits. Check that your largest cost is at most the capacity.

**Forgetting what happens when the store is down.** If Redis is unreachable, you must pick: allow everything, which keeps users working but removes protection, or reject everything, which protects the backend but causes an outage. Neither is universally right. Many teams allow traffic and fall back to a local in-process bucket with a conservative limit, which assumes the per-server multiplication described earlier is tolerable for a short outage.

**Trusting wall-clock time in your own code.** If you compute elapsed time from a clock that can step backward, the `max(0, ...)` guard prevents negative refills, but a forward jump still adds a large elapsed time. The capacity bounds the damage to one full bucket, but you would still have granted an unearned burst.

## Summary

A token bucket stores a token count that rises at the refill rate, stops at the capacity, and drops by one for each served request. Idle time fills the bucket, which is why a client can burst after a quiet spell, and the capacity limits how large that burst can be. Because the bucket refills at a fixed rate, the number of requests served in any T seconds never exceeds capacity plus refill rate times T, so the long-run average approaches the refill rate. To build one correctly, refill lazily when a request arrives, keep fractional tokens, make the check atomic, and pick the capacity deliberately.
