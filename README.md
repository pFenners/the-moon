# WebRTC Queuing Video Application

This project is a web application that demonstrates a client queuing system for viewing a WebRTC video feed from a single host. Clients join a queue, and the client at the front of the queue is shown a video feed from the host for a 5-minute duration. After 5 minutes, the feed switches to the next client in the queue.

## Features

*   **Host Video Streaming:** A single host can broadcast their webcam video and audio.
*   **Client Queue:** Clients can join a queue to watch the stream.
*   **Timed Viewing:** Each client at the front of the queue gets 5 minutes to view the stream.
*   **Automatic Switching:** The system automatically switches to the next client when the current client's time is up.
*   **Real-time Updates:** WebSocket is used for signaling and queue status updates.

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
    *   The host page will show a preview of the local video and indicate it's waiting for clients.

2.  **Client(s) Joining:**
    *   Open one or more web browser tabs/windows and go to `http://localhost:8080/` (or `http://localhost:8080/index.html`).
    *   Click the "Join Queue" button.
    *   The client page will show their queue status.
    *   The first client to join (or the one at the head of the queue when the host is ready) will start receiving the video stream from the host. A 5-minute countdown timer will begin on their page.

3.  **Viewing and Switching:**
    *   The current client views the stream.
    *   Other clients in the queue will see their updated queue position.
    *   When the 5-minute timer for the current client expires, they will be disconnected from the stream, and the next client in the queue will automatically start receiving the stream.

## Notes

*   This application uses a public STUN server (`stun:stun.l.google.com:19302`) for WebRTC NAT traversal. For production environments, you would typically deploy your own STUN/TURN server.
*   Error handling is basic. Check browser and server console logs for more detailed information if issues arise.
*   The host page allows only one active host. If you try to open `host.html` and become host while another is active (even in the same browser), the new host registration should be rejected.