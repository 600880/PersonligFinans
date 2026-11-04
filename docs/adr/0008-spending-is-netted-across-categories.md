---
status: accepted
---

# Spending is netted across Categories, and can be negative

A Category's Spending in a Period used to be clamped at zero, and a Period's total was the sum of what was left, so a refund in one Category never lowered another's. The Spending trend could draw signed figures while the donut couldn't, which left two different totals for the same Period and a trend whose rows didn't add up to its Total. We now net everything: each Category's Spending is its signed net over the Period, and every total is the sum of those figures. That makes the donut and the trend agree, and a quarter's Spending is the sum of its months'. The cost is that a refund posted in a later Period than the purchase it refunds makes that later Period look cheaper than it was (a TV bought in December and returned in March lowers March). We accept this because showing the refund openly is more honest than hiding it, and Quarter and Year Periods absorb most of it.

## Considered Options

- Clamp everywhere (the old rule): protects each Period from late refunds, but hides them, and a Category that only had refunds never shows.
- Clamp the donut, but let the trend show signed figures behind a "Show negative figures" checkbox: the two totals disagree, and with the box unticked the trend's rows don't add up to its Total.

## Consequences

- The donut has no slice for a Category with negative Spending. It lists the Category in the legend instead, with a hollow swatch and no share, and each slice's share is of the slices' sum rather than of the Total.
- With Include savings ticked, a Period where more was taken out of Savings than put in gets a negative Savings row, and the Total drops by that amount.
