#!/bin/bash

# MongoDB connection check script
echo "Checking MongoDB connection..."
mongosh "mongodb://root:example@localhost:27017/humanify" --eval "db.adminCommand('ping')" || { echo "MongoDB connection failed!"; exit 1; }

echo "Listing database collections..."
mongosh "mongodb://root:example@localhost:27017/humanify" --eval "db.getCollectionNames()"

echo "MongoDB connection success!" 