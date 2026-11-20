# Token bucket rate limiting

A rate limiter is code that decides, for each incoming request, whether to serve it or reject it, so that no single client can consume more than its share of a service. The hard part is deciding what "share" means. A limit such as "5 requests per second" does not say what should happen when a client is silent for a minute and then sends 10 requests at once. A token bucket answers that question precisely. The client may burst, meaning send many requests in a very short time, but only after resting, and never in a way that pushes its long run average above the limit. This post works one example by hand, states the general rule, runs a simulation, shows two implementations, and lists the mistakes that tend to appear in production.

## Why "5 per second" is not enough

The simplest limiter is a fixed window counter, a count that resets to zero at the start of every second and rejects requests once it reaches 5. It has a flaw at the boundaries. A client that sends 5 requests at 0.9 seconds and 5 more at 1.0 seconds has sent 10 requests in a tenth of a second, and the counter never objects, because the two batches fall into different windows. So the fixed window counter can allow up to twice the intended rate for a moment.

It also has the opposite flaw. A client that has been idle for a minute is treated exactly like one that has been busy, so it cannot send a legitimate burst, such as a page that loads 8 resources at once. A token bucket fixes both problems by keeping a running balance instead of a per second tally. The balance grows while the client is idle, up to a ceiling, and shrinks as the client sends requests.

## The idea, worked with numbers

Picture a bucket that holds tokens. Every request must remove one token to be served, and a request that finds the bucket empty is rejected. Tokens drip into the bucket at a steady refill rate. The bucket also has a capacity, the maximum number of tokens it can hold, so tokens that arrive when it is full spill and are lost.

Take a capacity of 10 and a refill rate of 5 tokens per second, and start with a full bucket of 10 tokens, which is the state after a quiet spell.

1. At time 0 the client sends 15 requests at once. The first 10 are served, because each finds a token, and the bucket is then empty. The other 5 are rejected, because there is nothing left to take. The client has been served 10 requests in an instant, twice what "5 per second" suggests for one second. That is the burst.
2. One second later the bucket holds 5 tokens, because 1 second at 5 tokens per second adds 5. The client sends 5 requests, all are served, and the bucket is empty again.
3. This repeats every second. The client is now held to 5 requests per second, because the bucket gains exactly as many tokens as the client spends. The burst was a one time spending of saved up balance, and once the balance is gone, only the refill rate remains.
4. Now suppose the client stops for 10 seconds. Ten seconds of refill would add 50 tokens, but the capacity is 10, so the bucket is full after 2 seconds and the other 40 tokens spill. This cap matters because without it a client that rested for an hour could save 18,000 tokens (5 times 3,600) and send them all at once. The capacity is what limits the size of any burst.

From this example you can state what the bucket guarantees. In any window of T seconds, the number of requests served is at most the capacity plus the refill rate times T, which here is 10 plus 5 times T. For a 1 second window that is at most 15. For a 60 second window it is at most 310, an average of about 5.17 per second. For a one hour window it is at most 18,010, an average of about 5.003 per second.

So the claim "the bucket enforces an average rate of 5 per second" is only approximately true. Over a window of length T the average can exceed the refill rate by at most the capacity divided by T, and that excess shrinks as the window grows. It reaches this maximum only when the bucket starts full and the client spends everything. A client that was already busy has a smaller allowance.

## The general rule

Each client has one bucket, and a bucket needs only four values. The capacity and the refill rate are fixed settings. The current number of tokens and the time of the last update change as requests arrive. When a request arrives at time `now` and costs `cost` tokens (usually 1), do three things in order.

First, add the tokens that dripped in since the last update, and cap the total at the capacity: `tokens = min(capacity, tokens + (now - last) * rate)`. You do this because tokens would have arrived at the refill rate during that gap, and the cap discards any overflow. Second, set `last` to `now`, because the elapsed time has now been counted and must not be counted again. Third, if `tokens` is at least `cost`, subtract `cost` and admit the request. Otherwise reject it and leave the tokens unchanged, because a rejected request used nothing.

This design has no timer that adds tokens. Nothing can observe the bucket between requests, so computing the refill at the moment a request arrives gives exactly the same answer as a timer would, and it costs nothing for the many clients that are idle.

Here is the rule with fractions. Use a capacity of 10, a rate of 5, and an empty bucket with `last` equal to 0.

- A request at 0.3 seconds: 0.3 seconds of refill adds 1.5 tokens. That is at least 1, so the request is admitted and 0.5 tokens remain.
- A request at 0.4 seconds: 0.1 seconds adds 0.5, making 1.0 token. It is admitted and the bucket is empty.
- A request at 0.5 seconds: 0.1 seconds adds 0.5, which is less than 1. It is rejected, and the 0.5 tokens stay in the bucket, with `last` set to 0.5.
- A request at 0.6 seconds: 0.1 seconds adds another 0.5, making 1.0. It is admitted.

The third step shows why the refilled amount must be stored even when a request is rejected. If you moved `last` forward but threw away the 0.5 tokens, the client would never accumulate a whole token under a steady stream of requests, and it would be starved.

One condition limits all of this. A request whose cost is larger than the capacity can never be admitted, because the bucket can never hold that many tokens.

## A simulation you can run

The following Python class implements the rule. It takes the clock as a parameter, so a test can supply a fake clock and get the same result every time.

```python
import time

class TokenBucket:
    def __init__(self, capacity, refill_per_second, now=time.monotonic):
        self.capacity = capacity
        self.rate = refill_per_second
        self.now = now
        self.tokens = capacity          # start full
        self.last = now()

    def allow(self, cost=1):
        t = self.now()
        elapsed = max(0.0, t - self.last)
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        self.last = t
        if self.tokens >= cost:
            self.tokens -= cost
            return True
        return False


class Clock:
    def __init__(self):
        self.t = 0.0
    def __call__(self):
        return self.t


clock = Clock()
bucket = TokenBucket(capacity=10, refill_per_second=5, now=clock)

# (time in seconds, number of requests sent at that instant)
events = [(0, 15), (1, 5), (2, 5), (12, 30)]
for when, count in events:
    clock.t = when
    admitted = sum(bucket.allow() for _ in range(count))
    print(f"t={when:>2}s  sent={count:>2}  admitted={admitted:>2}  rejected={count - admitted:>2}")
```

It should print:

```
t= 0s  sent=15  admitted=10  rejected= 5
t= 1s  sent= 5  admitted= 5  rejected= 0
t= 2s  sent= 5  admitted= 5  rejected= 0
t=12s  sent=30  admitted=10  rejected=20
```

The first three lines repeat the worked example. The last line shows the quiet spell: after 10 idle seconds the bucket is full but not overfull, so a burst of 30 is served only up to the capacity of 10. The class is correct for one thread. If several threads share a bucket, wrap `allow` in a lock, because two threads could otherwise read the same token count and both spend the same tokens.

## Sharing a bucket across servers

If your service runs on several servers, each server's own bucket sees only part of a client's traffic. With 4 servers and a limit of 5 per second, a client whose requests are spread evenly could get 20 per second. The exception is a load balancer that always sends one client to the same server, in which case per server buckets work. Otherwise the bucket must live in one shared place. Redis is a common choice, and the update must run as a single atomic step, because two servers that each read the bucket, change it, and write it back can both spend the same tokens. A Lua script runs atomically inside Redis:

```lua
-- KEYS[1] = bucket key; ARGV = capacity, rate per second, cost
local capacity = tonumber(ARGV[1])
local rate     = tonumber(ARGV[2])
local cost     = tonumber(ARGV[3])

local t   = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local data   = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = tonumber(data[1])
local last   = tonumber(data[2])
if tokens == nil then tokens = capacity; last = now end

tokens = math.min(capacity, tokens + math.max(0, now - last) * rate)

local allowed = 0
if tokens >= cost then tokens = tokens - cost; allowed = 1 end

redis.call('HSET', KEYS[1], 'tokens', tokens, 'last', now)
redis.call('EXPIRE', KEYS[1], math.ceil(capacity / rate))
return allowed
```

The script reads the time from Redis itself, because clocks on different application servers disagree by small amounts, and those differences would turn into phantom tokens or phantom shortages. The expiry is safe because a bucket left alone for `capacity / rate` seconds would be full anyway, and a missing bucket is created full, so deleting it changes nothing a client can observe. Redis versions before 5 may require you to call `redis.replicate_commands()` before using `TIME` in a script.

## Mistakes that bite in production

These are parallel traps, each of which has caused real incidents.

- **Using the wall clock in a single process.** The system clock can jump backwards when it is synchronized, which makes `now - last` negative and subtracts tokens. Use a monotonic clock (one that only moves forward, such as `time.monotonic`), and clamp elapsed time to zero as the code above does.
- **Spending tokens non atomically.** Reading the count, deciding, and writing it back as separate steps lets concurrent requests all see the same balance, so a client can get far more than its limit. Use a lock in one process or a script in Redis.
- **Choosing too large a capacity.** The capacity is the largest burst one client can send, and it is multiplied by the number of clients that burst together. If 100 clients each hold 10 tokens and all send a burst after a shared outage, your backend receives 1,000 requests at once. Set the capacity to what your backend can absorb, not to a round number.
- **Rejecting without saying when to retry.** A bare rejection makes clients retry immediately, which adds load. Return HTTP status 429 (Too Many Requests) with a `Retry-After` header. With 0.5 tokens, a cost of 1 and a rate of 5, the wait is (1 minus 0.5) divided by 5, which is 0.1 seconds. The header counts whole seconds, so send 1.
- **Never deleting idle buckets.** One bucket per client key is a small amount of memory until the keys are IP addresses or random identifiers, and then it is unbounded. Expire idle buckets, which is safe for the reason given above.
- **Choosing the wrong key.** Limiting by IP address means every user behind one office network shares one bucket, so one heavy user starves the rest. Limit by an authenticated account or API key where you can.
- **Deciding what happens when the shared store is down.** If Redis is unreachable you must either admit everything, which protects users but leaves the backend exposed, or reject everything, which protects the backend but takes the service down. Pick one on purpose and test it.

## Choosing the two numbers

Set the refill rate to the steady rate per client that your backend can afford, because that is the long run average the bucket enforces. Set the capacity to the longest burst a well behaved client legitimately needs, but no more than the burst your backend survives when many clients burst together. If a request is more expensive than others, give it a larger cost instead of a separate limiter, for example 5 tokens for a search and 1 for a lookup. The one condition to check is that the largest cost never exceeds the capacity.
