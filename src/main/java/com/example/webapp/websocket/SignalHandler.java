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

import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class SignalHandler extends TextWebSocketHandler {

    private static final Logger logger = LoggerFactory.getLogger(SignalHandler.class);
    private final Map<String, WebSocketSession> sessions = new ConcurrentHashMap<>();
    private WebSocketSession hostSession = null;
    private final QueueService queueService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    public SignalHandler(QueueService queueService) {
        this.queueService = queueService;
        this.queueService.setOnTimeUpCallback(this::handleTimeUpTriggeredByTimer); // Renamed for clarity
        this.queueService.setOnQueueChangedCallback(qs -> sendQueueStateToHost());
    }

    private void sendQueueStateToHost() {
        if (hostSession != null && hostSession.isOpen()) {
            Map<String, Object> queueState = new HashMap<>();
            queueState.put("type", "queue-state-update");
            synchronized (queueService) {
                queueState.put("currentClient", queueService.getCurrentClient());
                queueState.put("queuedClients", queueService.getQueuedClientIds());
            }
            try {
                sendMessage(hostSession, queueState);
                logger.info("Sent queue state update to host {}: current='{}', queue={}",
                    hostSession.getId(), queueState.get("currentClient"), queueState.get("queuedClients"));
            } catch (IOException e) {
                logger.error("Error sending queue state to host {}: {}", hostSession.getId(), e.getMessage());
            }
        } else {
            // logger.trace("Host not connected or session closed, cannot send queue state."); // Can be noisy
        }
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        sessions.put(session.getId(), session);
        logger.info("WebSocket connection established: {}. Total sessions: {}", session.getId(), sessions.size());
        sendMessage(session, Map.of("type", "session-id", "sessionId", session.getId()));
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        String payload = message.getPayload();
        // logger.debug("Received message from {}: {}", session.getId(), payload);

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

        // logger.info("Processing message type '{}' from {}", type, session.getId());


        switch (type) {
            case "register-host":
                // ... (existing code)
                if (hostSession == null || !hostSession.isOpen()) {
                    hostSession = session;
                    logger.info("Session {} registered as HOST.", session.getId());
                    sendMessage(session, Map.of("type", "host-registered", "message", "Successfully registered as host."));
                    sendQueueStateToHost();

                    String currentClient;
                    synchronized(queueService){ currentClient = queueService.getCurrentClient(); }

                    if (currentClient != null && sessions.containsKey(currentClient)) {
                         notifyHostAboutCurrentClient(currentClient);
                    } else if (currentClient == null) {
                        queueService.processNextClient();
                    }
                } else {
                    logger.warn("Attempt to register host from {} when host {} already exists.", session.getId(), hostSession.getId());
                    sendMessage(session, Map.of("type", "error", "message", "Host already registered."));
                    session.close(CloseStatus.POLICY_VIOLATION.withReason("Host already registered."));
                }
                break;
            case "offer":
                handleWebRTCSignal("offer", session, msgMap);
                break;
            case "answer":
                handleWebRTCSignal("answer", session, msgMap);
                break;
            case "ice-candidate":
                handleWebRTCSignal("ice-candidate", session, msgMap);
                break;
            case "join-queue-ws":
                // ... (existing code)
                String clientId = session.getId();
                boolean added = queueService.addClient(clientId);
                 Map<String, Object> response = new ConcurrentHashMap<>();
                 response.put("type", added ? "queue-joined" : "queue-join-failed");
                 response.put("sessionId", clientId);
                 response.put("position", queueService.getClientPosition(clientId));

                 String currentClientWsJoin;
                 synchronized(queueService) { currentClientWsJoin = queueService.getCurrentClient(); }
                 response.put("isCurrent", currentClientWsJoin != null && currentClientWsJoin.equals(clientId));

                 sendMessage(session, response);

                 if (added && currentClientWsJoin != null && currentClientWsJoin.equals(clientId)) {
                    notifyClientIsCurrent(session);
                    if (hostSession != null && hostSession.isOpen()) {
                        notifyHostAboutCurrentClient(clientId);
                    }
                 }
                break;
            case "host-force-end-current-client": // New case
                if (session == hostSession) {
                    String currentClientSessionId;
                    synchronized (queueService) { // Ensure atomic read of current client
                        currentClientSessionId = queueService.getCurrentClient();
                    }
                    if (currentClientSessionId != null) {
                        logger.info("Host {} is force-ending session for client {}.", session.getId(), currentClientSessionId);
                        // Call a method that encapsulates the logic for ending a client's turn
                        endClientTurn(currentClientSessionId, "Session ended by host.");
                        sendMessage(session, Map.of("type", "ack-force-end", "clientId", currentClientSessionId, "message", "Ending session for " + currentClientSessionId));
                    } else {
                        logger.info("Host {} tried to force-end session, but no client is current.", session.getId());
                        sendMessage(session, Map.of("type", "ack-force-end", "message", "No current client to end session for."));
                    }
                } else {
                    logger.warn("Non-host session {} tried to use 'host-force-end-current-client'. Denied.", session.getId());
                    sendMessage(session, Map.of("type", "error", "message", "Only host can force end a session."));
                }
                break;
            default:
                logger.warn("Unknown message type '{}' from {}.", type, session.getId());
                sendMessage(session, Map.of("type", "error", "message", "Unknown message type: " + type));
        }
    }

    private void handleWebRTCSignal(String signalType, WebSocketSession session, Map<String, Object> msgMap) throws IOException {
        String currentClientId;
        synchronized(queueService) { currentClientId = queueService.getCurrentClient(); }

        Object sdp = msgMap.get("sdp");
        Object candidate = msgMap.get("candidate");
        String targetClientIdSignal = (String) msgMap.get("targetClientId");

        if (session == hostSession) {
            String effectiveTarget = targetClientIdSignal != null ? targetClientIdSignal : currentClientId;
            if (effectiveTarget != null) {
                WebSocketSession clientWsSession = sessions.get(effectiveTarget);
                if (clientWsSession != null && clientWsSession.isOpen()) {
                    logger.info("Forwarding {} from HOST {} to CLIENT {}", signalType, hostSession.getId(), effectiveTarget);
                    Map<String, Object> forwardMsg = new ConcurrentHashMap<>();
                    forwardMsg.put("type", signalType);
                    if (sdp != null) forwardMsg.put("sdp", sdp);
                    if (candidate != null) forwardMsg.put("candidate", candidate);
                    sendMessage(clientWsSession, forwardMsg);
                } else {
                    logger.warn("Target client {} session not found or closed. Cannot forward {} from host.", effectiveTarget, signalType);
                }
            } else {
                logger.warn("Host {} sent {} but no current client in queue or target specified.", hostSession.getId(), signalType);
                sendMessage(session, Map.of("type", "error", "message", "No active client/target to send " + signalType));
            }
        } else if (session.getId().equals(currentClientId)) {
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
        } else {
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
            sessions.values().forEach(s -> {
                try {
                    sendMessage(s, Map.of("type", "host-disconnected", "message", "The host has disconnected."));
                } catch (IOException e) { /* ignore */ }
            });
        } else {
            logger.info("Client {} disconnected. Removing from queue if present.", session.getId());
            queueService.removeClient(session.getId());
        }
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        logger.error("Transport error for session {}: {}", session.getId(), exception.getMessage());
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
            // logger.warn("Attempted to send message to closed or null session: {} msg: {}", session == null ? "null" : session.getId() , messageData.get("type"));
        }
    }

    private void handleTimeUpTriggeredByTimer(String timedOutClientSessionId) {
        logger.info("Timer expired for client {}.", timedOutClientSessionId);
        endClientTurn(timedOutClientSessionId, "Your 5 minutes are up.");
    }

    private void endClientTurn(String clientToEndSessionId, String reasonMessage) {
        logger.info("Ending turn for client {}. Reason: {}", clientToEndSessionId, reasonMessage);
        WebSocketSession clientWsSession = sessions.get(clientToEndSessionId);
        if (clientWsSession != null && clientWsSession.isOpen()) {
            try {
                sendMessage(clientWsSession, Map.of("type", "disconnect-peer", "message", reasonMessage));
            } catch (IOException e) {
                logger.error("Error sending disconnect-peer message to {}: {}", clientToEndSessionId, e.getMessage());
            }
        }

        synchronized(queueService) {
            String currentClientInQueue;
            currentClientInQueue = queueService.getCurrentClient(); // Get current client within synchronized block

            if (clientToEndSessionId.equals(currentClientInQueue)) {
                queueService.processNextClient();
                String newCurrentClientId = queueService.getCurrentClient();
                if (newCurrentClientId != null) {
                    WebSocketSession newClientWsSession = sessions.get(newCurrentClientId);
                    if (newClientWsSession != null) {
                         notifyClientIsCurrent(newClientWsSession);
                    }
                    // notifyHostAboutCurrentClient is implicitly handled by onQueueChanged->sendQueueStateToHost
                    // and also explicitly if a new client becomes current and host is available.
                    if (hostSession != null && hostSession.isOpen()) {
                         notifyHostAboutCurrentClient(newCurrentClientId);
                    }
                }
            } else {
                logger.warn("Attempted to end turn for client {}, but they are no longer the current client. Current is {}. No queue advancement.",
                             clientToEndSessionId, currentClientInQueue);
                sendQueueStateToHost();
            }
        }
    }
}
