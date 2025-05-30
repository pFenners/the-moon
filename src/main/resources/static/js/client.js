const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const queueInfoDiv = document.getElementById('queueInfo');
const timerDisplay = document.getElementById('timerDisplay');
const joinQueueButton = document.getElementById('joinQueueButton');

let ws;
let pc; // RTCPeerConnection
let mySessionId = null;
let countdownInterval;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' } // Example STUN server
    ]
};

joinQueueButton.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        // If WS is open, try joining queue via WS message.
        // This assumes server's SignalHandler has 'join-queue-ws'
        statusDiv.textContent = 'Attempting to join queue via WebSocket...';
        ws.send(JSON.stringify({ type: 'join-queue-ws' }));
    } else {
        // Fallback or primary: Use HTTP endpoint to join, then connect WebSocket
        // For this example, we will primarily use WebSocket for joining after initial connection.
        // If WS is not even connected, first connect it.
        statusDiv.textContent = 'Connecting to server...';
        connectWebSocket(true); // Pass true to indicate intention to join queue
    }
    joinQueueButton.disabled = true;
};

function connectWebSocket(joinAfterConnect = false) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/signaling`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('WebSocket connection established for client.');
        statusDiv.textContent = 'Connected to server. Ready to join queue.';
        joinQueueButton.disabled = false; // Re-enable if it was disabled for connection
        if (joinAfterConnect) {
            statusDiv.textContent = 'Attempting to join queue via WebSocket...';
            ws.send(JSON.stringify({ type: 'join-queue-ws' }));
            joinQueueButton.disabled = true;
        }
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Client received message:', data);

        switch (data.type) {
            case 'session-id':
                mySessionId = data.sessionId;
                console.log("My session ID:", mySessionId);
                // If joinAfterConnect was true and button was used, it's already disabled.
                // If not, enable join button now that we have a session.
                // joinQueueButton.disabled = false; // Or manage state more carefully
                break;
            case 'queue-joined':
                statusDiv.textContent = 'Successfully joined queue.';
                queueInfoDiv.textContent = `Queue Position: ${data.position === 0 ? 'Current (or next)' : data.position}`;
                if (data.isCurrent) {
                    statusDiv.textContent = "You are the current client. Waiting for host's offer...";
                    // Server should send 'start-stream' or 'offer' next
                }
                joinQueueButton.style.display = 'none'; // Hide button after joining
                break;
            case 'queue-join-failed':
                statusDiv.textContent = `Failed to join queue: ${data.message || 'Perhaps already in queue.'}`;
                queueInfoDiv.textContent = `Queue Position: ${data.position}`;
                 if (data.isCurrent) {
                    statusDiv.textContent = "You are the current client. Waiting for host's offer...";
                }
                joinQueueButton.disabled = false;
                break;
            case 'queue-update': // Server could send this to update positions
                queueInfoDiv.textContent = `Queue Position: ${data.position}`;
                if (mySessionId === data.currentClientSessionId) {
                     statusDiv.textContent = "It's your turn! Waiting for host's offer.";
                }
                break;
            case 'start-stream': // Server says it's our turn
                statusDiv.textContent = "It's your turn! " + (data.message || "Waiting for host's offer.");
                // The actual offer will arrive in a separate 'offer' message
                break;
            case 'offer': // Received offer from host
                if (data.sdp) {
                    statusDiv.textContent = 'Offer received. Creating answer...';
                    console.log('Received offer:', data.sdp);
                    createPeerConnection();
                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        const answer = await pc.createAnswer();
                        await pc.setLocalDescription(answer);
                        console.log('Sending answer:', answer);
                        ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
                        startTimer(5 * 60); // Start 5 minute timer on client UI
                    } catch (e) {
                        console.error('Error handling offer on client:', e);
                        statusDiv.textContent = 'Error processing offer: ' + e.message;
                    }
                }
                break;
            case 'ice-candidate': // Received ICE candidate from host
                if (data.candidate && pc) {
                    try {
                        console.log('Received ICE candidate from host:', data.candidate);
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Error adding received ICE candidate on client:', e);
                    }
                }
                break;
            case 'disconnect-peer':
                statusDiv.textContent = (data.message || 'Your time is up.') + ' Disconnecting.';
                queueInfoDiv.textContent = 'Queue Position: N/A';
                closePeerConnection();
                stopTimer();
                timerDisplay.textContent = 'Time Left: --:--';
                remoteVideo.srcObject = null;
                joinQueueButton.style.display = 'block'; // Show join button again
                joinQueueButton.disabled = false;
                // Consider re-enabling join queue button or auto-rejoining
                break;
            case 'host-disconnected':
                statusDiv.textContent = 'Host has disconnected. Stream ended.';
                queueInfoDiv.textContent = 'Queue Position: N/A';
                closePeerConnection();
                stopTimer();
                timerDisplay.textContent = 'Time Left: --:--';
                remoteVideo.srcObject = null;
                joinQueueButton.style.display = 'block';
                joinQueueButton.disabled = false;
                break;
            case 'error':
                console.error('Received error from server:', data.message);
                statusDiv.textContent = 'Server error: ' + data.message;
                joinQueueButton.disabled = false; // Allow retry if appropriate
                break;
            default:
                console.log('Client received unhandled message type:', data.type);
        }
    };

    ws.onclose = () => {
        console.log('WebSocket connection closed for client.');
        statusDiv.textContent = 'Disconnected from server. Refresh to retry.';
        joinQueueButton.disabled = true; // Disable join until reconnected
        closePeerConnection();
        stopTimer();
    };

    ws.onerror = (error) => {
        console.error('WebSocket error for client:', error);
        statusDiv.textContent = 'WebSocket error. Check console.';
        joinQueueButton.disabled = true;
    };
}

function createPeerConnection() {
    if (pc) {
        console.log('Closing existing peer connection before creating new one.');
        pc.close();
    }
    pc = new RTCPeerConnection(rtcConfig);
    console.log('Client RTCPeerConnection created.');

    pc.onicecandidate = event => {
        if (event.candidate) {
            console.log('Client sending ICE candidate:', event.candidate);
            ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
        }
    };

    pc.ontrack = event => {
        console.log('Client received remote track.');
        statusDiv.textContent = 'Video stream started!';
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
        }
    };

    pc.oniceconnectionstatechange = () => {
        if (pc) {
            console.log(`Client ICE connection state: ${pc.iceConnectionState}`);
            if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'closed') {
                statusDiv.textContent = 'Stream disconnected.';
                // Server should manage this via 'disconnect-peer' or host leaving
                // closePeerConnection(); // Avoid duplicate cleanup if server also sends message
            } else if (pc.iceConnectionState === 'connected') {
                 statusDiv.textContent = 'Video stream connected!';
            }
        }
    };
}

function closePeerConnection() {
    if (pc) {
        console.log('Closing client peer connection.');
        pc.close();
        pc = null;
    }
    remoteVideo.srcObject = null; // Clear video display
}

function startTimer(durationInSeconds) {
    stopTimer(); // Clear any existing timer
    let timer = durationInSeconds;
    timerDisplay.textContent = formatTime(timer);

    countdownInterval = setInterval(() => {
        timer--;
        timerDisplay.textContent = formatTime(timer);
        if (timer <= 0) {
            stopTimer();
            // UI shows time is up; server will send 'disconnect-peer' to enforce it
            timerDisplay.textContent = 'Time Up!';
        }
    }, 1000);
}

function stopTimer() {
    clearInterval(countdownInterval);
}

function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

// Automatically try to connect WebSocket on page load for simplicity
// Client still needs to click "Join Queue"
connectWebSocket();
