const localVideo = document.getElementById('localVideo');
const statusDiv = document.getElementById('status');
const startHostButton = document.getElementById('startHostButton');
const clientQueueListUl = document.getElementById('clientQueueList');
const endCurrentClientSessionButton = document.getElementById('endCurrentClientSessionButton');

let localStream;
let ws;
let peerConnections = {}; // { clientId: { pc: RTCPeerConnection, controlChannel: RTCDataChannel } }
let currentStreamingClientId = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' }
    ]
};

startHostButton.onclick = async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        statusDiv.textContent = 'Host already started.';
        return;
    }
    statusDiv.textContent = 'Starting host...';
    startHostButton.disabled = true;
    endCurrentClientSessionButton.style.display = 'none';


    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
    } catch (e) {
        console.error('Error getting user media:', e);
        statusDiv.textContent = 'Error accessing camera/microphone: ' + e.message;
        startHostButton.disabled = false;
        return;
    }

    connectWebSocket();
};

endCurrentClientSessionButton.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log("Host clicking 'End Current Client Session'");
        ws.send(JSON.stringify({ type: 'host-force-end-current-client' }));
        statusDiv.textContent = "Attempting to end current client's session...";
    } else {
        console.error("WebSocket not connected. Cannot end session.");
        statusDiv.textContent = "Error: Not connected to server.";
    }
};

function updateClientQueueList(currentClientFromServer, queuedClients) {
    clientQueueListUl.innerHTML = '';

    if (currentClientFromServer) {
        const li = document.createElement('li');
        li.className = 'list-group-item current-client';
        li.textContent = `Current: ${currentClientFromServer} (Streaming)`;
        clientQueueListUl.appendChild(li);
        endCurrentClientSessionButton.style.display = 'block';

        if (currentStreamingClientId && currentStreamingClientId !== currentClientFromServer) {
            console.log(`Host: Server's current client ${currentClientFromServer} differs from host's streaming target ${currentStreamingClientId}.`);
            if (peerConnections[currentStreamingClientId]) {
                 console.log(`Closing PC for previously streaming client ${currentStreamingClientId} as server now reports ${currentClientFromServer} as current.`);
                 closePeerConnection(currentStreamingClientId);
            }
        }
    } else {
        endCurrentClientSessionButton.style.display = 'none';
        if (currentStreamingClientId) {
            console.log(`Host: Server reports no current client, but host thought ${currentStreamingClientId} was. Cleaning up PC for ${currentStreamingClientId}.`);
            closePeerConnection(currentStreamingClientId);
            currentStreamingClientId = null;
        }
    }

    if (queuedClients && queuedClients.length > 0) {
        queuedClients.forEach((clientId, index) => {
            const li = document.createElement('li');
            li.className = 'list-group-item';
            li.textContent = `Waiting ${index + 1}: ${clientId}`;
            clientQueueListUl.appendChild(li);
        });
    }

    if (!currentClientFromServer && (!queuedClients || queuedClients.length === 0)) {
        const li = document.createElement('li');
        li.className = 'list-group-item';
        li.textContent = 'No clients in queue.';
        clientQueueListUl.appendChild(li);
    }
}

function createPeerConnection(clientId) {
    if (peerConnections[clientId] && peerConnections[clientId].pc && peerConnections[clientId].pc.signalingState !== 'closed') {
        console.log(`Host: Peer connection for client ${clientId} already exists and not closed. Closing old one first.`);
        closePeerConnection(clientId);
    } else if (peerConnections[clientId]) { // It exists but might be just the entry or a closed PC
         console.log(`Host: Peer connection entry for client ${clientId} exists (possibly closed PC). Ensuring cleanup before recreating.`);
         closePeerConnection(clientId); // This will clear up any remnants
    }

    console.log(`Host: Creating new peer connection for client ${clientId}`);
    const pc = new RTCPeerConnection(rtcConfig);

    peerConnections[clientId] = { pc: pc, controlChannel: null };

    try {
        const controlChannel = pc.createDataChannel("control", { reliable: true });
        peerConnections[clientId].controlChannel = controlChannel;
        console.log(`Host: Created data channel "control" for client ${clientId}`);

        controlChannel.onopen = () => {
            console.log(`Host: Data channel "control" OPENED for client ${clientId}`);
            statusDiv.textContent = `Data channel active with ${clientId}.`;
        };

        controlChannel.onmessage = (event) => {
            // console.log(`Host: Raw message from client ${clientId} on "control" channel:`, event.data); // Can be too verbose
            try {
                const message = JSON.parse(event.data);
                // console.log(`Host: Parsed message from client ${clientId}:`, message); // Log parsed for general debugging

                switch (message.type) {
                    case 'client-ack':
                        console.log(`Host: Client ${clientId} acknowledged data channel connection: "${message.message}"`);
                        // statusDiv.textContent = `Client ${clientId} control channel active.`; // Optional UI update
                        break;
                    case 'mousemove':
                        console.log(`Host: Received mousemove from ${clientId}: dx=${message.dx}, dy=${message.dy}`);
                        // Here the host would eventually use message.dx and message.dy
                        break;
                    case 'keyAction':
                        console.log(`Host: Received keyAction from ${clientId}: key=${message.key}, action=${message.action}`);
                        // Here the host would eventually use message.key and message.action
                        break;
                    default:
                        console.log(`Host: Received unknown message type '${message.type}' from ${clientId} on "control" channel:`, message);
                        break;
                }
            } catch (e) {
                console.error(`Host: Failed to parse JSON from client ${clientId} on "control" channel. Data:`, event.data, "Error:", e);
            }
        };

        controlChannel.onerror = (error) => {
            console.error(`Host: Data channel "control" error for client ${clientId}:`, error);
        };

        controlChannel.onclose = () => {
            console.log(`Host: Data channel "control" CLOSED for client ${clientId}`);
            if (peerConnections[clientId]) {
                 peerConnections[clientId].controlChannel = null;
            }
        };
    } catch (e) {
        console.error(`Host: Error creating data channel for client ${clientId}:`, e);
        statusDiv.textContent = `Error creating data channel for ${clientId}.`;
    }

    pc.onicecandidate = event => {
        if (event.candidate) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                 ws.send(JSON.stringify({ type: 'ice-candidate', candidate: event.candidate, targetClientId: clientId }));
            } else {
                console.warn("Host: WebSocket not open, cannot send ICE candidate for client:", clientId);
            }
        }
    };

    pc.ontrack = event => {
        console.log(`Host: Received track from ${clientId}, which is unexpected.`);
    };

    pc.oniceconnectionstatechange = () => {
        const currentPCInfo = peerConnections[clientId];
        if (currentPCInfo && currentPCInfo.pc) {
            const currentPC = currentPCInfo.pc;
            console.log(`Host: ICE connection state for client ${clientId}: ${currentPC.iceConnectionState}`);
            if (currentPC.iceConnectionState === 'disconnected' || currentPC.iceConnectionState === 'closed' || currentPC.iceConnectionState === 'failed') {
                 statusDiv.textContent = `Client ${clientId} connection: ${currentPC.iceConnectionState}.`;
                 if (clientId === currentStreamingClientId) {
                    currentStreamingClientId = null;
                 }
                 closePeerConnection(clientId);
            } else if (currentPC.iceConnectionState === 'connected') {
                if (clientId === currentStreamingClientId) {
                    statusDiv.textContent = `Successfully connected to client ${clientId}.`;
                }
            }
        }
    };

    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    } else {
        console.error("Host: Local stream not available to add tracks for client:", clientId);
        statusDiv.textContent = `Error: Local stream not available for client ${clientId}.`;
    }
}

function closePeerConnection(clientId) {
    const pcInfo = peerConnections[clientId];
    if (pcInfo) {
        console.log(`Host: Closing peer connection and data channel for client ${clientId}`);

        if (pcInfo.controlChannel) {
            if (pcInfo.controlChannel.readyState !== 'closed') {
                pcInfo.controlChannel.close();
            }
            pcInfo.controlChannel.onopen = null;
            pcInfo.controlChannel.onmessage = null;
            pcInfo.controlChannel.onerror = null;
            pcInfo.controlChannel.onclose = null;
        }

        if (pcInfo.pc) {
            pcInfo.pc.onicecandidate = null;
            pcInfo.pc.ontrack = null;
            pcInfo.pc.oniceconnectionstatechange = null;
            pcInfo.pc.ondatachannel = null;
            if (pcInfo.pc.signalingState !== 'closed') {
                pcInfo.pc.close();
            }
        }
        delete peerConnections[clientId]; // Delete the entry from the map
    }
}

function connectWebSocket() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}/signaling`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Host: WebSocket connection established.');
        statusDiv.textContent = 'WebSocket connected. Registering as host...';
        ws.send(JSON.stringify({ type: 'register-host' }));
    };

    ws.onmessage = async (message) => {
        const data = JSON.parse(message.data);
        console.log('Host: Received message:', data);

        switch (data.type) {
            case 'host-registered':
                statusDiv.textContent = 'Host registered. Waiting for clients...';
                break;
            case 'queue-state-update':
                updateClientQueueList(data.currentClient, data.queuedClients);
                break;
            case 'client-ready':
                if (currentStreamingClientId && currentStreamingClientId !== data.clientId) {
                    console.log(`Host: New client ${data.clientId} is ready. Closing connection to previous client ${currentStreamingClientId}.`);
                    closePeerConnection(currentStreamingClientId);
                }
                currentStreamingClientId = data.clientId;
                statusDiv.textContent = `Client ${currentStreamingClientId} is ready. Creating offer...`;

                createPeerConnection(currentStreamingClientId);
                const pcInfo = peerConnections[currentStreamingClientId];
                if (!pcInfo || !pcInfo.pc) {
                    console.error("Host: Failed to create or get peer connection for client-ready:", currentStreamingClientId);
                    statusDiv.textContent = `Error setting up PC for ${currentStreamingClientId}`;
                    return;
                }
                const offer = await pcInfo.pc.createOffer();
                await pcInfo.pc.setLocalDescription(offer);
                console.log(`Host: Sending offer to client ${currentStreamingClientId}:`, offer);
                ws.send(JSON.stringify({ type: 'offer', sdp: offer, targetClientId: currentStreamingClientId }));
                break;
            case 'answer':
                const answerTargetInfo = peerConnections[currentStreamingClientId];
                if (data.sdp && currentStreamingClientId && answerTargetInfo && answerTargetInfo.pc && answerTargetInfo.pc.signalingState !== "closed") {
                    console.log(`Host: Received answer from client ${currentStreamingClientId}:`, data.sdp);
                    try {
                        await answerTargetInfo.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
                        statusDiv.textContent = `Streaming to client ${currentStreamingClientId}.`;
                    } catch (e) {
                        console.error('Host: Error setting remote description:', e);
                        statusDiv.textContent = `Error with client ${currentStreamingClientId}: ${e.message}`;
                    }
                } else {
                     console.warn('Host: Received answer but currentStreamingClientId/peerConnection is not set, sdp is missing, or PC is closed.', data, currentStreamingClientId, answerTargetInfo?.pc?.signalingState);
                }
                break;
            case 'ice-candidate':
                const iceCandidateTargetClient = data.originSessionId || currentStreamingClientId;
                const iceTargetInfo = peerConnections[iceCandidateTargetClient];
                if (data.candidate && iceCandidateTargetClient && iceTargetInfo && iceTargetInfo.pc && iceTargetInfo.pc.signalingState !== "closed") {
                    try {
                        console.log(`Host: Received ICE candidate from client ${iceCandidateTargetClient}:`, data.candidate);
                        await iceTargetInfo.pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) {
                        console.error('Host: Error adding received ICE candidate for client ' + iceCandidateTargetClient + ':', e);
                    }
                } else {
                     console.warn('Host: Received ICE candidate but target client or peerConnection not clear/available or PC is closed', data);
                }
                break;
            case 'ack-force-end':
                statusDiv.textContent = (data.message || "Force end acknowledged by server.") + (data.clientId ? ` Client: ${data.clientId}`: "");
                break;
            case 'session-id':
                console.log("Host: My host session ID:", data.sessionId);
                break;
            case 'queue-empty':
                 statusDiv.textContent = 'Client disconnected or queue is empty. Waiting for new clients...';
                 if (currentStreamingClientId) {
                    // closePeerConnection(currentStreamingClientId); // Let queue-state-update handle this.
                    // currentStreamingClientId = null;
                 }
                 break;
            case 'error':
                console.error('Host: Received error from server:', data.message);
                statusDiv.textContent = 'Server error: ' + data.message;
                if (data.message.includes("Host already registered")) {
                    ws.close();
                }
                break;
            default:
                console.log('Host: Received unhandled message type:', data.type);
        }
    };

    ws.onclose = () => {
        console.log('Host: WebSocket connection closed.');
        statusDiv.textContent = 'Disconnected. Click "Become Host" to restart.';
        localVideo.srcObject = null;
        if(localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        startHostButton.disabled = false;
        updateClientQueueList(null, []);
        endCurrentClientSessionButton.style.display = 'none';

        Object.keys(peerConnections).forEach(clientId => {
            closePeerConnection(clientId);
        });
        // peerConnections = {}; // closePeerConnection deletes entries, so this should be empty
        currentStreamingClientId = null;
    };

    ws.onerror = (error) => {
        console.error('Host: WebSocket error:', error);
        statusDiv.textContent = 'WebSocket error. Check console.';
    };
}

updateClientQueueList(null, []);
