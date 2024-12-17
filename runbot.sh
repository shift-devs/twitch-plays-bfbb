#!/bin/bash
cd ~/twitch-plays
while true; do
node index.js &>> bot.log
done
