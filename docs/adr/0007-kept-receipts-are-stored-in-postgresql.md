---
status: accepted
---

# Kept Receipts are stored in PostgreSQL

A saved Receipt is now kept with its Transaction by default, which reverses ADR 0004's promise that the app never stores the image. The image is stored in the app's own PostgreSQL database, in a table of its own so that reading Transactions never loads images, rather than in Azure Blob Storage. We chose this because one database means a Receipt is saved and deleted in the same transaction as its Transaction and its User, with no second store to keep in step or clean up, and it stays within the free tier's 32 GB. That only works because Receipts are reduced to around 300 KB before upload. Whatever a Receipt shows, such as card digits or a loyalty member ID, now sits in the database and its backups, and in the Guest every visitor can see it.
