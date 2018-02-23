# the-moon

Code for 'The Moon' project - a Wifi connected moon phase wall piece

## Hardware Used
- Wemos D1 Mini
- 28BYJ-48 Stepper motor with ULN2003 driver breakout board
- 2x BC337 NPN Transitors
- 10x Super bright white LEDs (T1 3/4 5mm)
- Blue OLED LCD Display Module (128x32 resolution)
- 2x 220ohm resistors
- 10x 100ohm resistors

## Additional Libraries Used
- ArduinoJson - https://github.com/bblanchon/ArduinoJson
- WiFiManager - https://github.com/tzapu/WiFiManager
- U8g2lib - https://github.com/olikraus/u8g2

## Circuit Diagram
![Circuit Diagram](docs/circuit.png?raw=true "Circuit Diagram")

## Code preperation / Setup
Go to http://api.wunderground.com/api and register and account for their API.
Add your API key to the_moon.ino in place of <<API_KEY_HERE>>.
Upload code to the Wemos D1 Mini using the Arduino GUI.

Once uploaded connect to 'The Moon' Wifi access point, click 'Configure Wifi'. select your Wifi access point and enter credentials.
'The Moon' will then connect to Wifi to get the current moon phase and then set the display accordingly.