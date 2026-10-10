@echo off
rem Double-click to play. Opens the game in its own fullscreen window.
rem (Add --windowed or --lan after play.py to change how it starts.)
cd /d "%~dp0"
start "" /min python play.py %*
