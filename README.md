# WebRTC Queuing Video Application

This project is a web application that demonstrates a client queuing system for viewing a WebRTC video feed from a single host. Clients join a queue, and the client at the front of the queue is shown a video feed from the host for a 5-minute duration. After 5 minutes, the feed switches to the next client in the queue.

## Features

*   **Host Video Streaming:** A single host can broadcast their webcam video and audio.
*   **Client Queue:** Clients can join a queue to watch the stream.
*   **Timed Viewing:** Each client at the front of the queue gets 5 minutes to view the stream.
*   **Automatic Switching:** The system automatically switches to the next client when the current client's time is up.
*   **Real-time Updates:** WebSocket is used for signaling and queue status updates.
*   **Remote Control (Client to Host):** Current client can send mouse movements and W,A,S,D keyboard commands to the host over a WebRTC data channel. Host currently logs these inputs.
*   **Client Preparation Countdown:** A 3-second countdown is displayed to the client before their session becomes fully active.

## Technology Stack

*   **Backend:** Java, Spring Boot (for web server, REST APIs, WebSocket)
*   **Frontend:** HTML, JavaScript (for WebRTC, WebSocket client, UI logic), CSS
*   **Build Tool:** Apache Maven

## Prerequisites

*   Java Development Kit (JDK) 17 or newer.
*   Apache Maven 3.6 or newer.
*   A modern web browser that supports WebRTC (e.g., Chrome, Firefox).

## Build Instructions

1.  Clone the repository (or ensure all code is in the correct directory structure).
2.  Navigate to the root directory of the project in your terminal.
3.  Run the Maven build command:
    ```bash
    mvn clean package
    ```
    This will compile the code and create an executable JAR file in the `target/` directory (e.g., `webapp-0.0.1-SNAPSHOT.jar`).

## Running the Application

1.  After a successful build, navigate to the `target/` directory or run from the root:
    ```bash
    java -jar target/webapp-0.0.1-SNAPSHOT.jar
    ```
    (Replace `webapp-0.0.1-SNAPSHOT.jar` with the actual name of the generated JAR if it differs).
2.  The server will start, typically on port 8080. You should see Spring Boot logs in your console.

## How to Use

1.  **Host Setup:**
    *   Open a web browser and go to `http://localhost:8080/host.html`.
    *   Click the "Become Host" button.
    *   Allow camera and microphone permissions when prompted by the browser.
    *   The host page will show a preview of the local video.
    *   **Queue Display:** Below the video, the host will see a list of clients currently in the queue. The client actively streaming will be highlighted.
    *   **Ending a Session:** If a client is currently streaming, an "End Current Client's Session" button will be visible. The host can click this button to immediately terminate that client's session and allow the next client in queue to start streaming.
    *   The status will indicate it's waiting for clients or streaming to a specific client.

2.  **Client(s) Joining:**
    *   Open one or more web browser tabs/windows and go to `http://localhost:8080/` (or `http://localhost:8080/index.html`).
    *   Click the "Join Queue" button.
    *   The client page will show their queue status.
    *   The first client to join (or the one at the head of the queue when the host is ready) will start receiving the video stream from the host. A 5-minute countdown timer will begin on their page.

3.  **Viewing and Switching:**
    *   The current client views the stream.
    *   Other clients in the queue will see their updated queue position.
    *   When the 5-minute timer for the current client expires, they will be disconnected from the stream, and the next client in the queue will automatically start receiving the stream.

### Client Remote Control (When Actively Streaming)

When it's a client's turn to view the stream, they will first see a 3-second preparation countdown overlay on the video.

Once the countdown ("Go!") finishes:
1.  **Activate Control Mode:** Click on the video area. This will hide your mouse cursor and enable control input. The status message will confirm you are in control mode.
2.  **Mouse Control:** Move your mouse. Relative mouse movements (changes in X and Y) will be sent to the host.
3.  **Keyboard Control:**
    *   Press **W, A, S, D** keys to send directional commands (forwards, left, backwards, right).
    *   "Key down" messages are sent when a key is first pressed.
    *   "Key up" messages are sent when the key is released.
4.  **Exit Control Mode:** Press the **Escape (Esc)** key. This will show your mouse cursor again and pause sending control inputs. You can click the video again to re-activate control mode.

**Note for Host:** Currently, the host application logs these received mouse and keyboard control messages to the browser's developer console. Implementing actions based on these controls on the host side (e.g., controlling a game or application) is a separate development task beyond the current scope of this application.

## Notes

*   This application uses a public STUN server (`stun:stun.l.google.com:19302`) for WebRTC NAT traversal. For production environments, you would typically deploy your own STUN/TURN server.
*   Error handling is basic. Check browser and server console logs for more detailed information if issues arise.
*   The host page allows only one active host. If you try to open `host.html` and become host while another is active (even in the same browser), the new host registration should be rejected.