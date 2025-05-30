package com.example.webapp.websocket;

import com.example.webapp.service.QueueService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import com.fasterxml.jackson.databind.ObjectMapper; // For JSON parsing

import java.io.IOException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(SignalHandler.class);
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private WebSocketSession hostSession = null;
    private final QueueService queueService;
    private final ObjectMapper objectMapper = new ObjectMapper(); // For parsing JSON messages

    @Autowired
    public SignalHandler(QueueService queueService) {
        this.queueService = queueService;
        // Set the callback in QueueService for when a client's time is up
        this.queueService.setOnTimeUpCallback(this::handleTimeUp);
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        logger.info("WebSocket connection established: {}. Total sessions: {}", session.getId(), sessions.size());
        // Send session ID to client for their reference (optional)
        sendMessage(session, Map.of("type", "session-id", "sessionId", session.getId()));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        logger.info("Received message from {}: {}", session.getId(), payload);

        Map<String, Object> msgMap;
        try {
            msgMap = objectMapper.readValue(payload, Map.class);
        } catch (IOException e) {
            logger.error("Error parsing JSON message from {}: {}", session.getId(), payload, e);
            sendMessage(session, Map.of("type", "error", "message", "Invalid JSON format."));
            return;
        }

        String type = (String) msgMap.get("type");
        if (type == null) {
            sendMessage(session, Map.of("type", "error", "message", "Message type not specified."));
            return;
        }

        switch (type) {
            case "register-host":
                if (hostSession == null || !hostSession.isOpen()) {
                    hostSession = session;
                    logger.info("Session {} registered as HOST.", session.getId());
                    sendMessage(session, Map.of("type", "host-registered", "message", "Successfully registered as host."));
                    // If a client is already waiting and current, notify host
                    String currentClient = queueService.getCurrentClient();
                    if (currentClient != null && sessions.containsKey(currentClient)) {
                         notifyHostAboutCurrentClient(currentClient);
                    } else if (currentClient == null) {
                        // No current client, try to process next from queue
                        queueService.processNextClient();
                        // processNextClient will eventually call notifyHost if a new client becomes current
                    }
                } else {
                    logger.warn("Attempt to register host from {} when host {} already exists.", session.getId(), hostSession.getId());
                    sendMessage(session, Map.of("type", "error", "message", "Host already registered."));
                    session.close(CloseStatus.POLICY_VIOLATION.withReason("Host already registered."));
                }
                break;
            case "offer": // From host to current client
                handleWebRTCSignal("offer", session, msgMap);
                break;
            case "answer": // From current client to host
                handleWebRTCSignal("answer", session, msgMap);
                break;
            case "ice-candidate": // Bidirectional
                handleWebRTCSignal("ice-candidate", session, msgMap);
                break;
            // Client-specific messages (could also be handled by QueueController if preferred for initial join)
            case "join-queue-ws": // Client wants to join queue via WebSocket
                String clientId = session.getId();
                boolean added = queueService.addClient(clientId);
                 Map<String, Object> response = new ConcurrentHashMap<>();
                 response.put("type", added ? "queue-joined" : "queue-join-failed");
                 response.put("sessionId", clientId);
                 response.put("position", queueService.getClientPosition(clientId));
                 response.put("isCurrent", queueService.getCurrentClient() != null && queueService.getCurrentClient().equals(clientId));
                 sendMessage(session, response);
                 if (added && queueService.getCurrentClient() != null && queueService.getCurrentClient().equals(clientId)) {
                    // This client was added and immediately became current
                    notifyClientIsCurrent(session);
                    if (hostSession != null && hostSession.isOpen()) {
                        notifyHostAboutCurrentClient(clientId);
                    }
                 }
                break;
            default:
                logger.warn("Unknown message type '{}' from {}.", type, session.getId());
                sendMessage(session, Map.of("type", "error", "message", "Unknown message type: " + type));
        }
    }

    private void handleWebRTCSignal(String signalType, WebSocketSession session, Map<String, Object> msgMap) throws IOException {
        String currentClientId = queueService.getCurrentClient();
        Object sdp = msgMap.get("sdp"); // For offer/answer
        Object candidate = msgMap.get("candidate"); // For ICE candidate

        if (session == hostSession) { // Message from HOST
            if (currentClientId != null) {
                WebSocketSession clientWsSession = sessions.get(currentClientId);
                if (clientWsSession != null && clientWsSession.isOpen()) {
                    logger.info("Forwarding {} from HOST {} to CLIENT {}", signalType, hostSession.getId(), currentClientId);
                    Map<String, Object> forwardMsg = new ConcurrentHashMap<>();
                    forwardMsg.put("type", signalType);
                    if (sdp != null) forwardMsg.put("sdp", sdp);
                    if (candidate != null) forwardMsg.put("candidate", candidate);
                    sendMessage(clientWsSession, forwardMsg);
                } else {
                    logger.warn("Current client {} session not found or closed. Cannot forward {} from host.", currentClientId, signalType);
                }
            } else {
                logger.warn("Host {} sent {} but no current client in queue.", hostSession.getId(), signalType);
                sendMessage(session, Map.of("type", "error", "message", "No active client to send " + signalType));
            }
        } else if (session.getId().equals(currentClientId)) { // Message from CURRENT CLIENT
            if (hostSession != null && hostSession.isOpen()) {
                logger.info("Forwarding {} from CLIENT {} to HOST {}", signalType, session.getId(), hostSession.getId());
                 Map<String, Object> forwardMsg = new ConcurrentHashMap<>();
                 forwardMsg.put("type", signalType);
                 if (sdp != null) forwardMsg.put("sdp", sdp);
                 if (candidate != null) forwardMsg.put("candidate", candidate);
                sendMessage(hostSession, forwardMsg);
            } else {
                logger.warn("Current client {} sent {} but host not available.", session.getId(), signalType);
                sendMessage(session, Map.of("type", "error", "message", "Host not available to receive " + signalType));
            }
        } else { // Message from a client NOT CURRENTLY ACTIVE for WebRTC signals
            logger.warn("Session {} (not current client) tried to send WebRTC signal '{}'. Ignoring.", session.getId(), signalType);
            sendMessage(session, Map.of("type", "error", "message", "You are not the active client for WebRTC."));
        }
    }

    public void notifyClientIsCurrent(WebSocketSession clientSession) {
        if (clientSession != null && clientSession.isOpen()) {
            logger.info("Notifying client {} that it is their turn.", clientSession.getId());
            try {
                sendMessage(clientSession, Map.of("type", "start-stream", "message", "It's your turn. Waiting for host offer."));
            } catch (IOException e) {
                logger.error("Failed to send start-stream notification to {}: {}", clientSession.getId(), e.getMessage());
            }
        }
    }

    public void notifyHostAboutCurrentClient(String clientSessionId) {
        if (hostSession != null && hostSession.isOpen()) {
            logger.info("Notifying host {} about new current client {}.", hostSession.getId(), clientSessionId);
            try {
                sendMessage(hostSession, Map.of("type", "client-ready", "clientId", clientSessionId, "message", "Client " + clientSessionId + " is ready for WebRTC offer."));
            } catch (IOException e) {
                logger.error("Failed to send client-ready notification to host {}: {}", hostSession.getId(), e.getMessage());
            }
        } else {
            logger.warn("Cannot notify host about client {}: host not connected.", clientSessionId);
        }
    }


    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        sessions.remove(session.getId());
        logger.info("WebSocket connection closed: {} with status {}. Total sessions: {}", session.getId(), status, sessions.size());
        if (session == hostSession) {
            logger.info("Host {} disconnected.", session.getId());
            hostSession = null;
            // Optionally notify all waiting clients that host is down
            sessions.values().forEach(s -> {
                try {
                    sendMessage(s, Map.of("type", "host-disconnected", "message", "The host has disconnected."));
                } catch (IOException e) { /* ignore */ }
            });
            // Maybe clear the queue or handle this state more gracefully
        } else {
            // If a client disconnects, remove them from the queue
            logger.info("Client {} disconnected. Removing from queue if present.", session.getId());
            queueService.removeClient(session.getId()); // This will trigger processNextClient if they were current
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        logger.error("Transport error for session {}: {}", session.getId(), exception.getMessage());
        // Consider removing session or specific error handling
        if (session == hostSession) {
            hostSession = null;
        }
        sessions.remove(session.getId());
        queueService.removeClient(session.getId());
    }

    private void sendMessage(WebSocketSession session, Map<String, Object> messageData) throws IOException {
        if (session != null && session.isOpen()) {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(messageData)));
        } else {
            logger.warn("Attempted to send message to closed or null session.");
        }
    }

    // This method is called by QueueService when a client's time is up
    private void handleTimeUp(String expiredClientSessionId) {
        logger.info("Handling time up for client {}.", expiredClientSessionId);
        WebSocketSession expiredClientWsSession = sessions.get(expiredClientSessionId);
        if (expiredClientWsSession != null && expiredClientWsSession.isOpen()) {
            try {
                sendMessage(expiredClientWsSession, Map.of("type", "disconnect-peer", "message", "Your 5 minutes are up."));
                // Optionally force close, but client should handle disconnect-peer
                // expiredClientWsSession.close(CloseStatus.NORMAL.withReason("Time up"));
            } catch (IOException e) {
                logger.error("Error sending disconnect-peer message to {}: {}", expiredClientSessionId, e.getMessage());
            }
        }

        // Crucially, tell QueueService to move to the next client
        // This needs to be thread-safe with other queue operations
        // The currentClientSessionId in QueueService should be checked before processing next.
        // If the client that timed out is still the current one, then process next.
        synchronized(queueService) { // Synchronize on queueService to ensure consistency
            if (expiredClientSessionId.equals(queueService.getCurrentClient())) {
                queueService.processNextClient();
                String newCurrentClientId = queueService.getCurrentClient();
                if (newCurrentClientId != null) {
                    WebSocketSession newClientWsSession = sessions.get(newCurrentClientId);
                    if (newClientWsSession != null) {
                         notifyClientIsCurrent(newClientWsSession);
                    }
                    if (hostSession != null && hostSession.isOpen()) {
                        notifyHostAboutCurrentClient(newCurrentClientId);
                    }
                } else {
                     if (hostSession != null && hostSession.isOpen()) {
                        try {
                            sendMessage(hostSession, Map.of("type", "queue-empty", "message", "The queue is now empty."));
                        } catch (IOException e) {
                             logger.error("Error sending queue-empty message to host: {}", e.getMessage());
                        }
                    }
                }
            } else {
                logger.warn("Client {} timed out, but was no longer the current client. No action taken to advance queue.", expiredClientSessionId);
            }
        }
    }
}
