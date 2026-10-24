---
status: accepted
---

# Receipt images are sent to the LLM whole

Until now the LLM only saw an imported Transaction's cleaned description and whether its Amount is negative or positive. Reading a Receipt sends the whole photo to Azure OpenAI, including anything else printed on it, such as line items, the store address, card digits or a loyalty member ID. We accept that wider exposure for the convenience of a pre-filled form. The app itself never stores the image (since replaced by ADR 0007: a saved Receipt is kept unless the user chooses not to keep it), but Azure may retain prompts for abuse monitoring under its own data policy.
