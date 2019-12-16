# MTG Oracle

Unofficial oracle skill for MTG cards. Currently supporting 8th ed up to the present time. 

You can ask about specific attributes of a card or get an overview of the card.

## Building

This skill currently gets data from the precompiled MTG Json run locally and uploaded to S3. This also generates the interaction model to link to the database. 

simply run: 

node ./data/build.js 

