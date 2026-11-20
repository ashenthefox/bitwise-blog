# Token bucket rate limiting

Suppose your API can handle an average of 2 requests per second from each client. You want to enforce that average. But a real client is often idle for a while and then sends a handful of requests at once, for example when a user opens a page that loads ten resources. Rejecting that handful would be unfriendly, because over the last minute the client has used far less than its share. So the question this post answers is: how do you hold a client to an average rate while still letting it send a burst after a quiet spell? The token bucket is a standard answer. Below you will work through it with numbers, run a small simulation, see two implementations, and read about the mistakes that cause trouble in production.

## A worked example before any definitions

A token bucket admits a request only if it can pay for it, and it earns the means to pay at a fixed rate. The rest of this section walks through that with real numbers.

Picture a counter that starts at 10. Every second, 2 is added to it, but it never goes above 10. Each incoming request tries to subtract 1. If the counter is at least 1, the subtraction happens and the request is allowed. If the counter is below 1, the request is rejected and the counter is unchanged.

Now let a client stay quiet for 10 seconds. The counter was already at 10, and additions beyond 10 are thrown away, so it is still 10. Then the client sends 15 requests in the same instant. The first 10 requests each subtract 1, so they are all allowed and the counter reaches 0. The remaining 5 are rejected because there is nothing left to subtract. Half a second later the counter has grown by 1, because 2 per second for 0.5 seconds is 1, so one more request can go through. From here on, the client gets 2 requests per second, no more, until it goes quiet again and the counter refills.

That is the whole mechanism. The client got a burst of 10 because it had been quiet, and it was then held to 2 per second because that is how fast the counter grows.

## The terms, now that you have seen them

Each unit in the counter is called a token. A request spends one token to be allowed. The counter itself is the bucket. The maximum the bucket can hold, 10 in the example, is the capacity, and it equals the largest burst a client can send at once. The amount added per second, 2 in the example, is the refill rate, and it equals the long-run average rate the client is held to.

Choosing these two numbers is the only design decision. If your backend can sustain 2 requests per second per client and can absorb 10 arriving together, set the refill rate to 2 and the capacity to 10. A larger capacity is friendlier to bursty clients but lets more load arrive at once. A larger refill rate raises the average. These are two separate parameters, and that separation is the token bucket's main advantage over simpler schemes.

## The general rule, and why it holds

Over any stretch of time of length T seconds, a token bucket admits at most capacity plus refill rate times T requests. The reason is that every allowed request spends a token, and tokens can come from only two places: the tokens already in the bucket when the stretch began, which are at most the capacity, and the tokens added during the stretch, which are the refill rate times T.

With capacity 10 and refill rate 2, the most a client can get in 60 seconds is 10 + 2 × 60 = 130 requests. That is an average of about 2.17 per second, so over one minute the client can exceed the target average by about 8%. Over an hour the bound is 10 + 2 × 3,600 = 7,210 requests, an average of about 2.003 per second, which is 0.14% above the target. So the claim "the bucket enforces an average of 2 per second" is exactly true only over long periods. Over a short period the client can exceed the average by up to one full bucket. If your backend cannot tolerate that excess, the fix is a smaller capacity, not a different algorithm.

The rule assumes each request costs one token. Some systems charge more for expensive requests, for example 5 tokens for a search and 1 for a lookup. The rule still holds if you count tokens instead of requests. One exception follows directly: a request that costs more than the capacity can never be allowed, because the bucket never holds that many tokens.

## A simulation you can run

The table below follows a client that sends 4 requests every second, which is twice the refill rate, and then goes quiet. Capacity is 10 and refill rate is 2. At each second, the bucket first receives the tokens earned since the previous second, and then the requests are processed.

| Second | Requests sent | Tokens before requests | Allowed | Rejected | Tokens after |
|---|---|---|---|---|---|
| 0 | 4 | 10 | 4 | 0 | 6 |
| 1 | 4 | 8 | 4 | 0 | 4 |
| 2 | 4 | 6 | 4 | 0 | 2 |
| 3 | 4 | 4 | 4 | 0 | 0 |
| 4 | 4 | 2 | 2 | 2 | 0 |
| 5 | 4 | 2 | 2 | 2 | 0 |
| 6 to 10 | 0 | refilling | 0 | 0 | 10 at second 10 |
| 11 | 15 | 10 | 10 | 5 | 0 |

For the first 4 seconds the client gets all 4 requests per second, 16 in total, because the bucket had a stored reserve to draw from. That matches the general rule: those 4 seconds span 3 seconds of refill, and 10 + 2 × 3 = 16. Once the reserve is spent, at second 4, the client is held to 2 per second. During the quiet spell from second 6 to second 10, the bucket refills by 2 per second until it reaches the capacity of 10. At second 11 the client is again allowed a burst of 10.

The code below reproduces this table. It replaces the real clock with a fake one so the output does not depend on how fast your machine runs. It uses the `TokenBucket` class from the next section, so put both in one file.

```python
class FakeClock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t

clock = FakeClock()
bucket = TokenBucket(capacity=10, refill_rate=2, clock=clock)
schedule = [4, 4, 4, 4, 4, 4, 0, 0, 0, 0, 0, 15]

for second, sent in enumerate(schedule):
    clock.t = second
    allowed = sum(bucket.allow() for _ in range(sent))
    print(f"second {second}: sent {sent}, allowed {allowed}, rejected {sent - allowed}")
```

Try changing the capacity to 3 and watch the bursts shrink while the steady rate stays at 2. Then change the refill rate to 4 and watch the client stop being rejected at all.

## A single-process implementation

You do not need a timer that adds tokens every second, because you can compute how many tokens the bucket would have earned at the moment a request arrives. This is called lazy refill: the bucket stores its token count and the time it was last updated, and on each request it adds the elapsed time multiplied by the refill rate, capped at the capacity. Lazy refill matters because a timer per bucket costs work for every client, including idle ones. With a million clients and a timer that fires once a second, that is a million updates per second spent on clients who are not sending anything.

```python
import threading
import time

class TokenBucket:
    def __init__(self, capacity, refill_rate, clock=time.monotonic):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = capacity
        self.clock = clock
        self.last = clock()
        self.lock = threading.Lock()

    def allow(self, cost=1):
        with self.lock:
            now = self.clock()
            elapsed = now - self.last
            self.last = now
            self.tokens = min(self.capacity, self.tokens + elapsed * self.refill_rate)
            if self.tokens >= cost:
                self.tokens -= cost
                return True
            return False
```

The token count is a floating-point number, because a request that arrives 0.1 seconds after the last one should find 0.2 new tokens, not zero. The lock exists because two threads could otherwise both read 1 token, both decide to allow, and both subtract, leaving the bucket at minus 1. The bucket starts full, so a new client can burst immediately. Starting it empty is also a valid choice, and the trade-off is discussed below.

## A shared implementation with Redis

If your API runs on several servers, a client's requests land on different machines, so the bucket has to live in shared storage. The read, compute and write must happen as one indivisible step, which is called an atomic operation, because otherwise the race described above happens across machines instead of across threads. In Redis you get atomicity by running the logic as a Lua script, since Redis executes one script at a time.

```lua
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local state = redis.call('HMGET', key, 'tokens', 'last')
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now

tokens = math.min(capacity, tokens + math.max(0, now - last) * rate)
local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', key, 'tokens', tokens, 'last', now)
redis.call('EXPIRE', key, math.ceil(capacity / rate) + 1)
return allowed
```

The script reads the time from Redis instead of accepting it from the caller, because each of your servers has a slightly different clock, and mixing their times would make elapsed time jump around. Calling `TIME` before a write is allowed in Redis 5 and later. On older versions the script must first call `redis.replicate_commands()`.

The expiry line keeps memory bounded. A bucket left alone for capacity divided by refill rate seconds, 5 seconds in the running example, is full anyway. Deleting it is therefore equivalent to keeping it, because a missing key is treated as a full bucket. This equivalence holds only because new buckets start full. If you start them empty, deleting an idle key would reset a full bucket to empty and wrongly reject the client's next burst.

## Mistakes that cause trouble in production

Each of these has been made in real systems, and each produces a specific, observable failure.

1. Using the wall clock instead of a monotonic clock. The wall clock can be stepped by time synchronization. If it steps back 30 seconds, the elapsed time is minus 30, and with a refill rate of 2 the bucket loses 60 tokens it never spent. If it steps forward, every bucket fills instantly. A monotonic clock, such as `time.monotonic` in Python, only moves forward. The `math.max(0, ...)` in the Redis script guards against the same problem on the shared clock.

2. Rounding tokens down to whole numbers while still updating the timestamp. Suppose a client sends a request every 0.1 seconds with a refill rate of 2. Each check earns 0.2 tokens, which rounds down to 0, and the timestamp moves forward anyway, so the fraction is lost every time. After its first burst, that client is rejected forever. Keep fractional tokens, or advance the timestamp only by the time you actually converted into whole tokens.

3. Forgetting the cap. Without the `min` with capacity, a client idle for a day at 2 tokens per second accumulates 172,800 tokens and can then send all of them at once. The cap is what turns "average rate" into "average rate with a bounded burst".

4. Keeping a separate bucket on each server without adjusting the numbers. With 5 servers, each holding its own bucket of capacity 10 and refill rate 2, a client spread across them gets a burst of 50 and an average of 10 per second, five times what you intended. Either share the bucket, as in the Redis version, or divide both numbers by the server count. Dividing is only approximately correct, because load balancers rarely spread one client's requests evenly.

5. Losing in-memory buckets on deploy. If buckets live in process memory and start full, every restart gives every client a fresh full bucket. A deploy that restarts 20 servers can let each client burst 20 times within minutes. Starting buckets empty avoids this, at the cost of rejecting a new client's very first requests.

6. Rejecting without saying when to retry. A rejected client that retries immediately is rejected again, and each attempt still costs you a network round trip and a bucket check. The wait until one request would be allowed is the missing tokens divided by the refill rate. With 0.4 tokens left, a cost of 1 and a refill rate of 2, that is 0.6 divided by 2, or 0.3 seconds. Send that value in a `Retry-After` header, rounded up to whole seconds because the header only accepts whole seconds, so well-behaved clients wait instead of spinning.

## Summary

A token bucket stores up to capacity tokens and earns them at the refill rate. Each request spends one. Because a quiet client accumulates tokens up to the capacity, it can burst that many requests at once. Because tokens are earned no faster than the refill rate, any period of T seconds admits at most capacity plus refill rate times T requests, so over long periods the client is held to the refill rate, and over short periods it can exceed that rate by at most one full bucket.
