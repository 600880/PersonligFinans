---
status: accepted
---

# The Guest is one shared User

Visitors who want to try the app without signing up all sign in as the same Guest User, instead of each getting a throwaway User of their own. It is the simplest way to offer a demo: no Users to create per visit and none to clean up afterwards. The cost is that every visitor sees and can change what any other visitor entered, and they share one Daily AI limit, so one visitor can use up the day's AI requests for the rest. When someone continues as the Guest, and whenever the app starts, the Guest is restored to a fixed Guest snapshot, so visitors start from a populated app rather than the bare seeds or the previous visitor's leftovers. That restore can pull the data out from under a visitor still using the Guest, which is accepted for now. Continuing restores it at most once every 20 minutes: anyone can continue as the Guest, and every User's rule changes wait while a restore runs, so unlimited restores would let one visitor stall the app for everyone. A visitor arriving within 20 minutes of the last restore may therefore find the previous visitor's changes. Its Daily AI limit is left as it is, or anyone could get a fresh one by continuing as the Guest again. Nothing a visitor did as the Guest carries over when they sign up, since the Guest's data belongs to everyone.
