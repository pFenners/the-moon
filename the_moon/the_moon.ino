#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <ArduinoJson.h>          //https://github.com/bblanchon/ArduinoJson
#include <Stepper.h>
#include <U8g2lib.h>
#include <math.h>
#include <DNSServer.h>            //Local DNS Server used for redirecting all requests to the configuration portal
#include <ESP8266WebServer.h>     //Local WebServer used to serve the configuration portal
#include <WiFiManager.h>          //https://github.com/tzapu/WiFiManager WiFi Configuration

// Wifi Manager
WiFiManager wifiManager;
const char* WIFISSID = "The Moon"; // Default SSID and password for initial setup access point
const char* WIFIPASS = "fullmoon";

// Web Sync
const String url = "http://api.wunderground.com/api/<<API_KEY_HERE>>/astronomy/q/UK/London.json";
const int httpTimeout = 10000;
const unsigned long interval = 3UL*60UL*60UL*1000UL; //3 hours
unsigned long previousSyncMillis = -interval; // trick to force first sync
int retryCount = 0;
const int retryCountReconnect = 5;
const int retryDelay = 60000;

// Stepper
#define STEPS 2038 // the number of steps in one revolution of 28BYJ-48
#define STEPPERIN1 D3
#define STEPPERIN2 D7
#define STEPPERIN3 D4
#define STEPPERIN4 D8
const int stepsPerPercentIllumination = 10; //= STEPS/2/100
Stepper myStepper(STEPS, STEPPERIN1, STEPPERIN2, STEPPERIN3, STEPPERIN4);
int currentStepPosition = 0;

// OLED
U8G2_SSD1306_128X32_UNIVISION_1_HW_I2C u8g2(U8G2_R0, /*reset=*/ U8X8_PIN_NONE, /*clock=*/D1, /*data=*/D2 );  

// LEDs
#define LEDPINLEFT D5
#define LEDPINRIGHT D6

void setup() 
{ 
  u8g2.begin();
  
  pinMode(LEDPINLEFT, OUTPUT);
  pinMode(LEDPINRIGHT, OUTPUT);
  
  Serial.begin(115200);
  delay(10);
  Serial.println("STARTUP");
   
  myStepper.setSpeed(5);

  u8g2.firstPage();
  do {
    u8g2.setFont(u8g2_font_helvR12_tf);
    u8g2.drawStr(0,14,"Starting Up...");
  } while ( u8g2.nextPage() );

  wifiManager.setDebugOutput(false);
  wifiManager.setConfigPortalTimeout(300);
  wifiManager.setCustomHeadElement("<style>button{background-color:#66ffff; color: black;}\na { color: white; }\nbody { color: white; background: black url(data:image/png;base64,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) left top no-repeat;}\n.l {background-image: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgBAMAAACBVGfHAAAALVBMVEUAAAD7+Pg+PT0PDw/Mycl9fHzc2dmsqqrr6Oi8urqdm5ttbGxeXFwfHh6Ni4vNt76WAAAAWklEQVQoz2MgFhwXFKxB5lsKAsFkBJ/ZESQgYgAXYBeUeKSdKFgAF1AU9AVpE4ILLBS8ANSXKAUXcAQzN4rABQRFIRqpKMAmCAcJYAFGhIDA8BfgQAg0EBPtAO2OF5ActN7/AAAAAElFTkSuQmCC);}</style>");

  wifiReconnect();
  
  homeMotor();

  //demoRun();
} 

void homeMotor()
{
  Serial.println("** Homing Motor");
  // We don't know where the motor is currenlty at so move back to start position. Move the maximum possible amount just in case it is all the way over the other side. The motor will stall if it reaches the end before the steps have completed, for low powered stepper this isn't an issue. 
  for(int i=0; i<(STEPS)/stepsPerPercentIllumination; i++) { // Move motor in small increments to stop the ESP8266 watchdog timer forcing a restart, large steps block for too long
     myStepper.step(-stepsPerPercentIllumination);
     yield();
  }
  currentStepPosition = 0;
  delay(500);
}

void demoRun()
{
  // First 14 days, from New Moon to Full Moon (0% to 100% illumination)
  for(int d=1; d<=14; d++) {
    setMoonState(round(d*7.14), d, "Demo Mode"); // 7.14 is the percent illumination change per day (100%/14)
    delay(1000);
  }
  // Second 14 days, from Full Moon to New Moon (100% to 0% illumination)
  for(int d=1; d<=14; d++) {
    setMoonState(100-round(d*7.14), d+14, "Demo Mode");
    delay(1000);
  }
}

void loop() 
{ 
  if (millis() - previousSyncMillis >= interval) { // Check if we've reached the sync interval
      syncMoonPhase();
  }
} 

void syncMoonPhase() {
  Serial.println("** Syncing Moon Phase");
  
  HTTPClient http;
  http.begin(url);
  http.setTimeout(httpTimeout);
  
  int httpCode = http.GET();
  if(httpCode == HTTP_CODE_OK) {
    processSyncData(http.getString()); //JSON data is returned from the API
    previousSyncMillis = millis();
    retryCount = 0;
  } else {
    Serial.print("Web service call failed - Waiting to retry. HTTP Code: ");
    Serial.println(httpCode);
    previousSyncMillis = previousSyncMillis + (retryDelay * (retryCount + 1)); // set interval to try again
    
    retryCount++;
    Serial.print("Retry count: ");
    Serial.println(retryCount);
    
    if(retryCount % retryCountReconnect == 0) wifiReconnect(); // reconnect wifi every retryCountReconnect retries
    if(retryCount > retryCountReconnect) {
      u8g2.firstPage();
      do {
        u8g2.setFont(u8g2_font_helvR12_tf );
        u8g2.drawStr(0,12, "Connection Error");
        u8g2.drawStr(0,28, "Retrying...");
        digitalWrite(LEDPINRIGHT, LOW);
        digitalWrite(LEDPINLEFT, LOW);
      } while ( u8g2.nextPage() ); 
    }
  }
  http.end();
 
}

void processSyncData(String moonData) {
  // Parse the JSON received from the webservice and pull out the values we need (percent illumination, age of the moon in days, text description of the moon phase)
  
  //Serial.println("moonData=");
  //Serial.println(moonData);
  
  const size_t bufferSize = 
            JSON_OBJECT_SIZE(1) + 
            8*JSON_OBJECT_SIZE(2) + 
            2*JSON_OBJECT_SIZE(3) + 
            JSON_OBJECT_SIZE(9) + 440;
            
  DynamicJsonBuffer jsonBuffer(bufferSize);

  JsonObject& root = jsonBuffer.parseObject(moonData);
  JsonObject& moon_phase = root["moon_phase"];

  if (!root.success()) {
    Serial.println("JSON parsing failed!");
  } else {
    const char* moon_phase_percentIlluminated = moon_phase["percentIlluminated"];
    int percent = atoi( moon_phase_percentIlluminated );

    const char* moon_phase_ageOfMoon = moon_phase["ageOfMoon"];
    int age = atoi( moon_phase_ageOfMoon );

    const char* moon_phase_text = moon_phase["phaseofMoon"];
    
    setMoonState(percent, age, moon_phase_text);
  }
}

void setMoonState(int percentIlluminted, int ageOfMoon, String moonPhase) {

  int targetStepPosition;
  int direction;
 
  if(ageOfMoon <= 14)  {
    targetStepPosition = stepsPerPercentIllumination * percentIlluminted;
  } else {
    targetStepPosition = stepsPerPercentIllumination * (100 - percentIlluminted);
  }

  int stepsToTake = targetStepPosition - currentStepPosition;
  //Serial.println(stepsToTake);

  if(abs(stepsToTake) > (STEPS/2)/2) {
    // If we are doing the switch from "Full Moon">"Waning Gibbous" or "Waning Crescent">"New Moon" the motor moves from left to right, keep all LEDs on while it does this to make the transition look smoother
    digitalWrite(LEDPINRIGHT, HIGH);
    digitalWrite(LEDPINLEFT, HIGH);
  }

  for(int i=0; i<=abs(stepsToTake)/stepsPerPercentIllumination; i++) {
     if(stepsToTake < 0) myStepper.step(-stepsPerPercentIllumination);
     else myStepper.step(stepsPerPercentIllumination);
     yield();
  }

  currentStepPosition = targetStepPosition;

  disableStepperOutputs();

  if(ageOfMoon <= 14)  {
    digitalWrite(LEDPINRIGHT, HIGH);
    digitalWrite(LEDPINLEFT, LOW);
  } else {
    digitalWrite(LEDPINRIGHT, LOW);
    digitalWrite(LEDPINLEFT, HIGH);
  }

  // Convert String to char arrays for drawing to display
  // Splits text description of moon phase in to two lines to make room for percentage on right hand side of the screen
  String firstLineString = moonPhase.substring(0, moonPhase.indexOf(" "));
  String secondLineString = moonPhase.substring(moonPhase.indexOf(" ") +1);
  String percentString = "%";
  percentString = percentIlluminted + percentString;
  
  char firstLine[firstLineString.length() + 1];
  char secondLine[secondLineString.length() + 1];
  char percent[percentString.length() + 1];
    
  firstLineString.toCharArray(firstLine, firstLineString.length() + 1);
  secondLineString.toCharArray(secondLine, secondLineString.length() + 1);
  percentString.toCharArray(percent, percentString.length() + 1);

    u8g2.firstPage();
    do {
      if(moonPhase != "Full Moon") {
        u8g2.setFont(u8g2_font_helvR14_tf);
        u8g2.drawStr(0,14, firstLine);
        u8g2.drawStr(0,32, secondLine);
        u8g2.drawStr(90,24, percent);
      } else {
        u8g2.setFont(u8g2_font_helvR18_tf);
        u8g2.drawStr(10,22,"Full Moon");
      }
    } while ( u8g2.nextPage() );
}

void disableStepperOutputs() {
  digitalWrite(STEPPERIN1, LOW);
  digitalWrite(STEPPERIN2, LOW);
  digitalWrite(STEPPERIN3, LOW);
  digitalWrite(STEPPERIN4, LOW);
}

void wifiReconnect() {
  //WiFi.disconnect();
  //delay(3000);
  
  if(!wifiManager.autoConnect(WIFISSID, WIFIPASS)) {
    Serial.println("Failed to connect and hit timeout");
    delay(3000);
    ESP.reset(); //reset and try again
    delay(5000);
  } 
  
  //wifiManager.startConfigPortal(WIFISSID, WIFIPASS);
  
  Serial.println("Wifi connected");
}

