# Token bucket rate limiting

A rate limiter answers one question for every incoming request: should this client be served now, or told to slow down? The simplest answer, "allow at most 2 requests per second," treats a client who has been quiet for a minute the same as one who has been hammering your API all along. Real clients don't behave that way. A mobile app opens, fires ten requests to load its home screen, and then goes idle. You want to allow that burst and still hold the client to 2 requests per second over the long run.

A token bucket does both. This post walks through one simulation with real numbers, then the general rule, then two implementations, and then the mistakes that cause trouble in production.

## The idea in one example

A token bucket gives each client a stock of permissions that refills at a steady pace, and each request spends one. Here is a concrete case before any definitions.

Suppose client A has a bucket that holds at most 10 tokens and gains 2 tokens every second. A token is one permission to make one request. Client A has been quiet for a while, so its bucket is full at 10 tokens.

At time 0.0 seconds, client A sends 12 requests at once. The first 10 are admitted, because there are 10 tokens and each request spends one. The last 2 are rejected, because the bucket is empty by then. The bucket now holds 0 tokens.

At time 0.5 seconds, client A sends 3 more requests. Half a second has passed, and the bucket gains 2 tokens per second, so it has earned 1 token. The first request spends it and is admitted. The other 2 are rejected. The bucket is at 0 again.

At time 1.0 seconds, client A sends 1 request. Another half second has passed, so the bucket has 1 token again, and the request is admitted.

Then client A goes quiet. At time 6.0 seconds it sends 1 request. Five seconds have passed, which earns 10 tokens, so the bucket is full again at 10. The request is admitted, leaving 9.

Finally, client A stays quiet for a long time and sends 12 requests at time 20.0 seconds. Fourteen seconds have passed, which would earn 28 tokens, but the bucket holds at most 10, so it sits at 10. Ten requests are admitted and 2 are rejected. That is the same result as at time 0, because waiting longer than 5 seconds earned client A nothing extra.

Two numbers controlled everything above. The capacity is the most tokens the bucket can hold, which was 10, and it sets the largest burst a client can make at once. The refill rate is how many tokens the bucket gains per second, which was 2, and it sets the long run average. The capacity is the parameter you vary to make the limiter more or less tolerant of bursts. The refill rate is the parameter you vary to change the sustained throughput you allow.

## The live simulation

You can run this simulation yourself and change the numbers. It reproduces the trace above exactly.

```python
CAPACITY = 10      # most tokens the bucket can hold
RATE = 2.0         # tokens gained per second

tokens = CAPACITY  # the client starts after a quiet spell, so the bucket is full
last = 0.0         # time of the last refill, in seconds

def allow(now):
    global tokens, last
    elapsed = max(0.0, now - last)
    tokens = min(CAPACITY, tokens + elapsed * RATE)
    last = now
    if tokens >= 1:
        tokens -= 1
        return True
    return False

arrivals = [(0.0, 12), (0.5, 3), (1.0, 1), (6.0, 1), (20.0, 12)]

for t, count in arrivals:
    admitted = sum(allow(t) for _ in range(count))
    print(f"t={t:>5.1f}s  requests={count:>2}  admitted={admitted:>2}  "
          f"rejected={count - admitted:>2}  tokens left={tokens:.1f}")
```

The output is:

```
t=  0.0s  requests=12  admitted=10  rejected= 2  tokens left=0.0
t=  0.5s  requests= 3  admitted= 1  rejected= 2  tokens left=0.0
t=  1.0s  requests= 1  admitted= 1  rejected= 0  tokens left=0.0
t=  6.0s  requests= 1  admitted= 1  rejected= 0  tokens left=9.0
t= 20.0s  requests=12  admitted=10  rejected= 2  tokens left=0.0
```

Try setting `CAPACITY = 1`. The burst at time 0 then admits only 1 request, and the limiter behaves like a strict "one request every half second" rule. Try `CAPACITY = 100`, and the burst of 12 is fully admitted. Those two runs show that capacity alone decides how bursty a client may be.

## The general rule

Notice that the code never runs a timer to add tokens. Instead, every time a request arrives, it calculates how many tokens the bucket would have earned since the last request. This is called lazy refill: you update the bucket only when someone looks at it. It works because the refill is a simple function of elapsed time, so computing it later gives the same answer as adding tokens continuously.

Each check does four things, in this order:

1. Measure the time elapsed since the last refill.
2. Add the elapsed time multiplied by the refill rate, but never let the total exceed the capacity.
3. Record the current time as the last refill time.
4. If at least one token is available, subtract one and admit the request; otherwise reject it.

The order matters. If you checked for a token before refilling, a client who had been quiet for 5 seconds would be rejected on their first request, because the bucket would still show the stale count of 0.

From this rule follows the guarantee that makes token buckets useful. Over any stretch of time lasting T seconds, a client can be admitted at most capacity plus refill rate times T requests. The capacity term covers the tokens already saved up at the start, and the refill term covers the tokens earned during the stretch. With capacity 10 and refill rate 2, the most a client can get in 60 seconds is 10 plus 120, which is 130 requests.

That means the limit "2 requests per second" is only approximately true over short windows. Over 60 seconds, 130 requests is an average of about 2.17 per second, which is 8 percent above the refill rate. Over 10 seconds the maximum is 30 requests, an average of 3 per second, which is 50 percent above. Over one second it is 12 requests. The longer the window, the closer the true average gets to the refill rate, because the fixed capacity becomes a smaller fraction of the total. If you need a hard ceiling over short windows, choose a small capacity.

This guarantee holds when each request costs one token and when one bucket is the only thing tracking a client. Both conditions can break. Some systems charge expensive requests more tokens, which is fine if you apply the same arithmetic. The case where several servers each keep their own bucket is covered below as a mistake.

## Implementation inside one process

If one server handles all of a client's traffic, you can keep the buckets in memory. This version handles many clients and is safe when several threads check the same client at once.

```python
import threading
import time

class TokenBucket:
    def __init__(self, capacity, rate):
        self.capacity = capacity
        self.rate = rate
        self.tokens = capacity
        self.last = time.monotonic()
        self.lock = threading.Lock()

    def try_take(self, cost=1):
        with self.lock:
            now = time.monotonic()
            elapsed = max(0.0, now - self.last)
            self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
            self.last = now
            if self.tokens >= cost:
                self.tokens -= cost
                return True, 0.0
            wait = (cost - self.tokens) / self.rate
            return False, wait
```

The lock exists because two threads could otherwise both read 1 token, both decide to admit, and both subtract, which admits two requests on one token. The code uses `time.monotonic()` instead of `time.time()` because the monotonic clock never moves backward, while the wall clock can jump when the system synchronizes its time. The second return value tells the caller how long to wait before a retry would succeed. For example, with 0.4 tokens left and a refill rate of 2, the client must wait 0.6 tokens divided by 2 tokens per second, which is 0.3 seconds. Send that to the client in a `Retry-After` header so well behaved clients don't guess.

Store one `TokenBucket` for each client, keyed by API key or user ID, in a dictionary. That dictionary grows forever unless you remove idle entries, so evict any bucket that has not been touched for longer than capacity divided by refill rate seconds. After that long, the bucket would be full anyway, so a fresh bucket created later is identical to the old one, and removing it changes nothing a client can observe.

## Implementation shared across servers

Most production APIs run several servers behind a load balancer, so each client's requests land on different machines. The buckets must then live in a shared store such as Redis, and each check must happen as one indivisible operation. In Redis, a Lua script provides that, because Redis runs each script to completion before running any other command.

```lua
-- KEYS[1]: bucket key for this client
-- ARGV[1]: capacity, ARGV[2]: refill rate per second, ARGV[3]: cost
local capacity = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
local cost = tonumber(ARGV[3])

local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000

local state = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now

local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * rate)

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HSET', KEYS[1], 'tokens', tostring(tokens), 'last', tostring(now))
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / rate * 1000))

return { allowed, tostring(tokens) }
```

The script reads the time from Redis itself rather than taking it from the calling server, because different servers' clocks can disagree by tens or hundreds of milliseconds, and that disagreement would turn into tokens granted or lost. Calling `TIME` inside a script is allowed in Redis 5 and later when scripts replicate their effects, which is the only mode in Redis 7. A missing key is treated as a full bucket, which is correct because the expiry removes a key only after the bucket would have refilled completely. The token count is returned as a string because Redis truncates Lua numbers to integers when it returns them, which would drop the fraction.

## Mistakes that bite in production

Each of these mistakes passes a quick test and fails under real traffic.

Leaving out the capacity cap. Without the `min`, a client who is idle for a day at 2 tokens per second saves up 172,800 tokens and can then send 172,800 requests in a single burst. The cap is the only thing that limits a burst after a quiet spell.

Throwing away fractional tokens. Suppose you store whole tokens, add the rounded down value of elapsed time multiplied by rate, and set the last refill time to now. A client sending one request every 0.4 seconds at a refill rate of 2 earns 0.8 tokens each time, which rounds down to 0, and the timestamp moves forward anyway. That client never earns a single token and is rejected forever, even though it is sending only 2.5 requests per second against a budget of 2. Keep fractional tokens, or move the timestamp forward only by the time the whole tokens actually represent.

Giving each server its own bucket. If four servers each keep an in-memory bucket with a refill rate of 2, a client whose requests are spread evenly across them gets 8 requests per second, and a burst of 40 instead of 10. Either share the state as shown above, or divide the refill rate and capacity by the number of servers. The second approach is only approximately right, because load balancers rarely spread one client's traffic perfectly evenly.

Reading and writing the bucket in separate steps. If a server reads the token count from Redis, decides in application code, and then writes back, two servers can read the same count of 1 at the same moment and both admit. Under a burst of 50 simultaneous requests, this can admit far more than the capacity. Do the whole check in one atomic operation.

Using the wall clock. If the system clock jumps backward by 2 seconds, the elapsed time becomes negative 2, and without the `max(0, ...)` guard the bucket loses 4 tokens. If it jumps forward, the client gets free tokens. Use a monotonic clock in one process, and the store's clock across servers.

Refilling with a background timer. A timer that adds tokens to every bucket every second costs work proportional to the number of clients, even idle ones. With a million keys that is a million writes per second spent on clients who aren't sending anything. Lazy refill does work only when a request arrives.

## Choosing the numbers

Start from the sustained rate you can afford to serve per client, and set the refill rate to that. Then look at the largest burst a legitimate client produces, such as the 10 requests an app sends when it opens, and set the capacity a little above it. Remember that a client can always be admitted capacity plus refill rate times T requests over T seconds, so check that your backend can absorb a full burst from many clients at once. If 1,000 clients each burst 10 requests at the same second, that is 10,000 requests arriving together.
