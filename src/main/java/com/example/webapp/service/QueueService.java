package com.example.webapp.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer; // For callback

@Service
public class QueueService {

    private static final Logger logger = LoggerFactory.getLogger(QueueService.class);
    private final Queue<String> clientQueue = new ConcurrentLinkedQueue<>();
    private String currentClientSessionId = null;
    private final ScheduledExecutorService timerExecutor = Executors.newSingleThreadScheduledExecutor();
    private Consumer<String> onTimeUpCallback; // Callback to notify when time is up for a client

    // Method to set the callback that will be triggered when a client's time is up
    public void setOnTimeUpCallback(Consumer<String> onTimeUpCallback) {
        this.onTimeUpCallback = onTimeUpCallback;
    }

    public synchronized boolean addClient(String sessionId) {
        if (!clientQueue.contains(sessionId) && !sessionId.equals(currentClientSessionId)) {
            boolean added = clientQueue.offer(sessionId);
            if (added) {
                logger.info("Client {} added to queue. Queue size: {}", sessionId, clientQueue.size());
                if (currentClientSessionId == null) {
                    processNextClient(); // If no one is current, process immediately
                }
            }
            return added;
        }
        logger.warn("Client {} already in queue or is current.", sessionId);
        return false;
    }

    public synchronized String getCurrentClient() {
        return currentClientSessionId;
    }

    public synchronized int getClientPosition(String sessionId) {
        if (sessionId.equals(currentClientSessionId)) {
            return 0; // Current client is at position 0
        }
        int position = 1;
        for (String idInQueue : clientQueue) {
            if (idInQueue.equals(sessionId)) {
                return position;
            }
            position++;
        }
        return -1; // Not in queue and not current
    }

    public synchronized int getQueueSize() {
        return clientQueue.size();
    }

    // This method will be called internally or by a controller/websocket handler when the current client disconnects or time is up.
    public synchronized void processNextClient() {
        if (currentClientSessionId != null) {
            // Potentially some cleanup for the old client if needed
            logger.info("Processing next client. Current {} is being replaced.", currentClientSessionId);
        }

        currentClientSessionId = clientQueue.poll(); // Retrieves and removes the head of the queue

        if (currentClientSessionId != null) {
            logger.info("New client {} is now current. Starting 5-minute timer.", currentClientSessionId);
            // Start 5-minute timer for the new currentClientSessionId
            timerExecutor.schedule(() -> {
                logger.info("Timer up for client {}.", currentClientSessionId);
                if (this.onTimeUpCallback != null) {
                    this.onTimeUpCallback.accept(currentClientSessionId); // Trigger callback
                } else {
                    logger.warn("onTimeUpCallback is not set. Cannot notify about timer expiration.");
                }
                // Logic to switch to the next client will be triggered by the callback
                // or explicitly called after this. For now, we just log.
                // processNextClient(); // This would be called by the component handling the time up event
            }, 5, TimeUnit.MINUTES);
        } else {
            logger.info("Queue is empty. No client to process.");
        }
    }

    public synchronized void removeClient(String sessionId) {
        boolean removedFromQueue = clientQueue.remove(sessionId);
        if (removedFromQueue) {
            logger.info("Client {} removed from queue.", sessionId);
        }

        if (sessionId.equals(currentClientSessionId)) {
            logger.info("Current client {} disconnected/removed. Processing next.", sessionId);
            // Stop any active timer for this client immediately if needed (though schedule might not be easily cancellable without storing Future)
            // For simplicity, timer will run its course but callback should check if client is still current.
            currentClientSessionId = null; // Clear current client
            processNextClient(); // Process the next one
        }
    }

    // Ensure graceful shutdown for the executor
    public void shutdown() {
        timerExecutor.shutdown();
        try {
            if (!timerExecutor.awaitTermination(60, TimeUnit.SECONDS)) {
                timerExecutor.shutdownNow();
            }
        } catch (InterruptedException ex) {
            timerExecutor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
