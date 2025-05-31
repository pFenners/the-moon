const remoteVideo = document.getElementById('remoteVideo');
const statusDiv = document.getElementById('status');
const queueInfoDiv = document.getElementById('queueInfo');
const timerDisplay = document.getElementById('timerDisplay');
const joinQueueButton = document.getElementById('joinQueueButton');
const preparationOverlay = document.getElementById('preparationOverlay');
const preparationCountdownText = document.getElementById('preparationCountdownText');

let ws;
let pc;
let controlDataChannel;
let mySessionId = null;
let countdownInterval; // For 5-min viewing timer
let preparationCountdownInterval; // For 3s preparation countdown
let isInControlMode = false; // Flag to track if client is in control mode

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

// Object to keep track of currently pressed keys to avoid OS repeat spam
const keysPressed = {
    'W': false,
    'A': false,
    'S': false,
    'D': false
};

// Function to handle mouse movements when in control mode
function handleMouseMovement(event) {
    if (!isInControlMode) return;

    if (controlDataChannel && controlDataChannel.readyState === 'open') {
        const dx = event.movementX || 0;
        const dy = event.movementY || 0;
        controlDataChannel.send(JSON.stringify({
            type: "mousemove",
            dx: dx,
            dy: dy
        }));
    }
}

// Function to handle W,A,S,D and Escape key events
function handleControlKeys(event) {
    if (!isInControlMode) return;

    const key = event.key.toUpperCase(); // Normalize to uppercase

    if (event.type === 'keydown') {
        if (key === 'ESCAPE') {
            exitControlMode();
            return;
        }

        if (['W', 'A', 'S', 'D'].includes(key)) {
            if (!keysPressed[key]) {
                keysPressed[key] = true;
                if (controlDataChannel && controlDataChannel.readyState === 'open') {
                    console.log(`Client: Key down: ${key}`);
                    controlDataChannel.send(JSON.stringify({
                        type: "keyAction",
                        key: key,
                        action: "down"
                    }));
                }
                // event.preventDefault(); // Optional: if W,A,S,D cause page scroll or other defaults
            }
        }
    } else if (event.type === 'keyup') {
        if (['W', 'A', 'S', 'D'].includes(key)) {
            if (keysPressed[key]) {
                keysPressed[key] = false;
                if (controlDataChannel && controlDataChannel.readyState === 'open') {
                    console.log(`Client: Key up: ${key}`);
                    controlDataChannel.send(JSON.stringify({
                        type: "keyAction",
                        key: key,
                        action: "up"
                    }));
                }
            }
        }
    }
}


// Function to start the 3-second preparation countdown
function startPreparationCountdown(callback) {
    if (preparationCountdownInterval) {
        clearInterval(preparationCountdownInterval);
    }
    preparationOverlay.style.display = 'flex';
    let count = 3;
    preparationCountdownText.textContent = count;
    console.log("Client: Starting preparation countdown...");

    preparationCountdownInterval = setInterval(() => {
        count--;
        if (count > 0) {
            preparationCountdownText.textContent = count;
        } else if (count === 0) {
            preparationCountdownText.textContent = 'Go!';
        } else {
            clearInterval(preparationCountdownInterval);
            preparationCountdownInterval = null;
            preparationOverlay.style.display = 'none';
            console.log("Client: Preparation countdown finished.");
            if (callback) callback();
        }
    }, 1000);
}

function stopPreparationCountdown() {
    if (preparationCountdownInterval) {
        clearInterval(preparationCountdownInterval);
        preparationCountdownInterval = null;
        preparationOverlay.style.display = 'none';
        console.log("Client: Preparation countdown stopped.");
    }
}

// Function to enable the click listener for activating control mode
function enableControlModeActivation() {
    console.log("Client: Control mode activation enabled. Click video to start.");
    statusDiv.textContent = 'Click the video to start controlling.';
    remoteVideo.addEventListener('click', enterControlMode);
}

// Function to disable the click listener for activating control mode
function disableControlModeActivation() {
    remoteVideo.removeEventListener('click', enterControlMode);
    console.log("Client: Control mode activation disabled.");
}

// Function to enter control mode
function enterControlMode() {
    if (!controlDataChannel || controlDataChannel.readyState !== 'open') {
        console.warn("Client: Cannot enter control mode, data channel not open.");
        statusDiv.textContent = "Control channel not ready. Please wait.";
        disableControlModeActivation();
        enableControlModeActivation();
        return;
    }
    if (isInControlMode) return;

    isInControlMode = true;
    console.log("Client: Entered control mode.");
    statusDiv.textContent = 'Control Mode ACTIVE. Move mouse & use W,A,S,D. Press ESC to exit.';

    document.body.style.cursor = 'none';

    attachControlListeners();
    disableControlModeActivation();
}

// Function to exit control mode
function exitControlMode() {
    if (!isInControlMode) return;

    isInControlMode = false;
    console.log("Client: Exited control mode.");
    statusDiv.textContent = 'Controls paused. Click video to re-activate.';

    document.body.style.cursor = 'auto';
    detachControlListeners();

    for (const key in keysPressed) {
        if (Object.hasOwnProperty.call(keysPressed, key)) {
            keysPressed[key] = false;
        }
    }

    enableControlModeActivation();
}

// Attach control event listeners (mouse/keyboard)
function attachControlListeners() {
    console.log("Client: Attaching control listeners (mouse/keyboard).");
    document.addEventListener('mousemove', handleMouseMovement);
    document.addEventListener('keydown', handleControlKeys);
    document.addEventListener('keyup', handleControlKeys);
}

// Detach control event listeners
function detachControlListeners() {
    console.log("Client: Detaching control listeners (mouse/keyboard).");
    document.removeEventListener('mousemove', handleMouseMovement);
    document.removeEventListener('keydown', handleControlKeys);
    document.removeEventListener('keyup', handleControlKeys);
}


joinQueueButton.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        statusDiv.textContent = 'Attempting to join queue via WebSocket...';
        ws.send(JSON.stringify({ type: 'join-queue-ws' }));
    } else {
        statusDiv.textContent = 'Connecting to server...';
        connectWebSocket(true);
    }
    joinQueueButton.disabled = true;
};

function connectWebSocket(joinAfterConnect = false) {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/signaling`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Client: WebSocket connection established.');
        statusDiv.textContent = 'Connected to server. Ready to join queue.';
        joinQueueButton.disabled = false;
        if (joinAfterConnect) {
            statusDiv.textContent = 'Attempting to join queue via WebSocket...';
            ws.send(JSON.stringify({ type: 'join-queue-ws' }));
            joinQueueButton.disabled = true;
        }
    };
    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Client: Received message:', data);

        switch (data.type) {
            case 'session-id':
                mySessionId = data.sessionId;
                console.log("Client: My session ID:", mySessionId);
                break;
            case 'queue-joined':
                statusDiv.textContent = 'Successfully joined queue.';
                queueInfoDiv.textContent = `Queue Position: ${data.position === 0 ? 'Current (or next)' : data.position}`;
                if (data.isCurrent) {
                    statusDiv.textContent = "You are the current client. Waiting for host's offer...";
                }
                joinQueueButton.style.display = 'none';
                break;
            case 'queue-join-failed':
                statusDiv.textContent = `Failed to join queue: ${data.message || 'Perhaps already in queue.'}`;
                queueInfoDiv.textContent = `Queue Position: ${data.position}`;
                 if (data.isCurrent) {
                    statusDiv.textContent = "You are the current client. Waiting for host's offer...";
                }
                joinQueueButton.disabled = false;
                break;
            case 'queue-update':
                queueInfoDiv.textContent = `Queue Position: ${data.position}`;
                if (mySessionId === data.currentClientSessionId && !pc) {
                     statusDiv.textContent = "It's your turn! Waiting for host's offer.";
                } else if (mySessionId === data.currentClientSessionId && pc && pc.connectionState === 'connected' && !isInControlMode && !preparationCountdownInterval) {
                    statusDiv.textContent = "Currently streaming. Click video to control.";
                }
                break;
            case 'start-stream':
                statusDiv.textContent = "It's your turn! " + (data.message || "Waiting for host's offer.");
                break;
            case 'offer':
                if (data.sdp) {
                    statusDiv.textContent = 'Offer received. Creating answer...';
                    console.log('Client: Received offer:', data.sdp);
                    createPeerConnection();

                    try {
                        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        console.log("Client: Remote description set from offer.");
                        const answer = await pc.createAnswer();
                        console.log("Client: Answer created.");
                        await pc.setLocalDescription(answer);
                        console.log("Client: Local description set with answer.");
                        ws.send(JSON.stringify({ type: 'answer', sdp: answer }));
                        console.log("Client: Sent answer to server.");
                    } catch (e) {
                        console.error('Client: Error handling offer:', e);
                        statusDiv.textContent = 'Error processing offer: ' + e.message;
                        closePeerConnection();
                    }
                } else {
                    console.warn("Client: Offer message received without SDP.", data);
                }
                break;
            case 'ice-candidate':
                if (data.candidate && pc) {
                    try {
                        console.log('Client: Received ICE candidate from host:', data.candidate);
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                        console.log("Client: Added host's ICE candidate.");
                    } catch (e) {
                        console.error('Client: Error adding received ICE candidate:', e);
                    }
                } else if (!pc) {
                     console.warn("Client: Received ICE candidate but PeerConnection (pc) is not initialized.");
                }
                break;
            case 'disconnect-peer':
                statusDiv.textContent = (data.message || 'Your time is up.') + ' Disconnecting.';
                queueInfoDiv.textContent = 'Queue Position: N/A';
                closePeerConnection();
                stopTimer();
                timerDisplay.textContent = 'Time Left: --:--';
                joinQueueButton.style.display = 'block';
                joinQueueButton.disabled = false;
                break;
            case 'host-disconnected':
                statusDiv.textContent = 'Host has disconnected. Stream ended.';
                queueInfoDiv.textContent = 'Queue Position: N/A';
                closePeerConnection();
                stopTimer();
                timerDisplay.textContent = 'Time Left: --:--';
                joinQueueButton.style.display = 'block';
                joinQueueButton.disabled = false;
                break;
            case 'error':
                console.error('Client: Received error from server:', data.message);
                statusDiv.textContent = 'Server error: ' + data.message;
                joinQueueButton.disabled = false;
                break;
            default:
                console.log('Client: Received unhandled message type:', data.type);
        }
    };
    ws.onclose = () => {
        console.log('Client: WebSocket connection closed.');
        statusDiv.textContent = 'Disconnected from server. Refresh to retry.';
        joinQueueButton.disabled = true;
        closePeerConnection();
        stopTimer();
    };
    ws.onerror = (error) => {
        console.error('Client: WebSocket error:', error);
        statusDiv.textContent = 'WebSocket error. Check console.';
        joinQueueButton.disabled = true;
    };
}

function createPeerConnection() {
    if (pc) {
        console.log('Client: Closing existing peer connection before creating new one.');
        closePeerConnection();
    }
    console.log('Client: Creating new RTCPeerConnection.');
    pc = new RTCPeerConnection(rtcConfig);

    pc.ondatachannel = (event) => {
        if (event.channel.label === "control") {
            controlDataChannel = event.channel;
            console.log('Client: Received "control" data channel from host.');

            controlDataChannel.onopen = () => {
                console.log('Client: Data channel "control" OPENED.');
                if (controlDataChannel.readyState === 'open') {
                     controlDataChannel.send(JSON.stringify({ type: "client-ack", message: "Client connected via data channel!" }));
                }
            };
            controlDataChannel.onmessage = (eventMessage) => {
                 console.log('Client: Message from host on "control" channel:', eventMessage.data);
            };
            controlDataChannel.onerror = (error) => {
                console.error('Client: Data channel "control" error:', error);
            };
            controlDataChannel.onclose = () => {
                console.log('Client: Data channel "control" CLOSED.');
                if (isInControlMode) {
                    exitControlMode();
                }
                controlDataChannel = null;
            };
        } else {
            console.warn('Client: Received an unknown data channel:', event.channel.label);
        }
    };
    pc.onicecandidate = event => {
        if (event.candidate) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate }));
            } else {
                 console.warn("Client: WebSocket not open, cannot send ICE candidate.");
            }
        }
    };

    pc.ontrack = event => {
        console.log('Client: Remote track received.', event.streams);
        if (event.streams && event.streams[0]) {
            console.log('Client: Assigning stream to remoteVideo element.');
            remoteVideo.srcObject = event.streams[0];
            statusDiv.textContent = 'Video stream active! Preparing...';

            startPreparationCountdown(() => {
                enableControlModeActivation();
            });

            if (!countdownInterval) startTimer(5 * 60);
        } else {
            console.warn('Client: Ontrack event fired without a stream.');
        }
    };

    pc.oniceconnectionstatechange = () => {
         if (pc) {
            console.log(`Client: ICE connection state changed to: ${pc.iceConnectionState}`);
            switch(pc.iceConnectionState) {
                case "connected":
                    break;
                case "disconnected":
                    statusDiv.textContent = 'Stream disconnected. Attempting to reconnect...';
                    stopPreparationCountdown();
                    if (isInControlMode) exitControlMode();
                    break;
                case "failed":
                    statusDiv.textContent = 'Stream connection failed.';
                    closePeerConnection();
                    break;
                case "closed":
                    statusDiv.textContent = 'Stream connection closed.';
                    closePeerConnection();
                    break;
            }
        }
    };
    pc.onsignalingstatechange = () => {
        if (pc) {
            console.log(`Client: Signaling state changed to: ${pc.signalingState}`);
        }
    };
}


function closePeerConnection() {
    if (isInControlMode) {
        exitControlMode();
    }
    disableControlModeActivation();
    stopPreparationCountdown();

    if (controlDataChannel) {
        if (controlDataChannel.readyState !== 'closed') {
            controlDataChannel.close();
        }
        controlDataChannel.onopen = null;
        controlDataChannel.onmessage = null;
        controlDataChannel.onerror = null;
        controlDataChannel.onclose = null;
        controlDataChannel = null;
        console.log('Client: Control data channel closed and cleaned up.');
    }
    if (pc) {
        console.log('Client: Closing peer connection.');
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.oniceconnectionstatechange = null;
        pc.onsignalingstatechange = null;
        pc.ondatachannel = null;
        if (pc.signalingState !== 'closed') {
            pc.close();
        }
        pc = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject.getTracks().forEach(track => track.stop());
        remoteVideo.srcObject = null;
        console.log('Client: Remote video cleared and tracks stopped.');
    }
}

function startTimer(durationInSeconds) {
    stopTimer();
    let timer = durationInSeconds;
    timerDisplay.textContent = formatTime(timer);
    console.log("Client: Starting 5-minute viewing timer for " + durationInSeconds + " seconds.");
    countdownInterval = setInterval(() => {
        timer--;
        timerDisplay.textContent = formatTime(timer);
        if (timer <= 0) {
            stopTimer();
            timerDisplay.textContent = 'Time Up!';
        }
    }, 1000);
}
function stopTimer() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
        console.log("Client: 5-minute viewing timer stopped.");
    }
}
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

connectWebSocket();
