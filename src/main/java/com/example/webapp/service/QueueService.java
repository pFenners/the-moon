package com.example.webapp.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList; // Added
import java.util.List;      // Added
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;

@Service
public class QueueService {

    private static final Logger logger = LoggerFactory.getLogger(QueueService.class);
    private final Queue<String> clientQueue = new ConcurrentLinkedQueue<>();
    private String currentClientSessionId = null;
    private final ScheduledExecutorService timerExecutor = Executors.newSingleThreadScheduledExecutor();
    private Consumer<String> onTimeUpCallback;
    private Consumer<QueueService> onQueueChangedCallback; // Callback for general queue changes

    public void setOnTimeUpCallback(Consumer<String> onTimeUpCallback) {
        this.onTimeUpCallback = onTimeUpCallback;
    }

    // Callback to notify when the queue structure or current client changes
    public void setOnQueueChangedCallback(Consumer<QueueService> onQueueChangedCallback) {
        this.onQueueChangedCallback = onQueueChangedCallback;
    }

    private void notifyQueueChanged() {
        if (onQueueChangedCallback != null) {
            onQueueChangedCallback.accept(this);
        }
    }

    public synchronized boolean addClient(String sessionId) {
        if (!clientQueue.contains(sessionId) && !sessionId.equals(currentClientSessionId)) {
            boolean added = clientQueue.offer(sessionId);
            if (added) {
                logger.info("Client {} added to queue. Queue size: {}", sessionId, clientQueue.size());
                notifyQueueChanged(); // Notify change
                if (currentClientSessionId == null) {
                    processNextClient();
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
            return 0;
        }
        int position = 1;
        for (String idInQueue : clientQueue) {
            if (idInQueue.equals(sessionId)) {
                return position;
            }
            position++;
        }
        return -1;
    }

    public synchronized int getQueueSize() {
        return clientQueue.size();
    }

    // New method to get the list of clients in the queue (not including current)
    public synchronized List<String> getQueuedClientIds() {
        return new ArrayList<>(clientQueue);
    }

    public synchronized void processNextClient() {
        if (currentClientSessionId != null) {
            logger.info("Processing next client. Current {} is being replaced.", currentClientSessionId);
        }

        currentClientSessionId = clientQueue.poll();

        if (currentClientSessionId != null) {
            logger.info("New client {} is now current. Starting 5-minute timer.", currentClientSessionId);
            timerExecutor.schedule(() -> {
                // logger.info("Timer up for client {}.", currentClientSessionId); // This logs the client ID at the time of scheduling
                final String scheduledClientId = this.currentClientSessionId; // Capture client ID at time of scheduling for correct logging
                logger.info("Timer up for client {}.", scheduledClientId);

                if (this.onTimeUpCallback != null) {
                    // Check if the client that timed out is still the current one
                    // This check is important if client disconnected early and timer fired later
                    synchronized(this) { // ensure check and callback are atomic regarding currentClientSessionId
                         if (scheduledClientId != null && scheduledClientId.equals(this.currentClientSessionId)) { // Check against current client at time of execution
                            this.onTimeUpCallback.accept(this.currentClientSessionId);
                         } else {
                             logger.info("Timer fired for {} but they are no longer the current client. Current is {}.", scheduledClientId, this.currentClientSessionId);
                         }
                    }
                } else {
                    logger.warn("onTimeUpCallback is not set. Cannot notify about timer expiration.");
                }
            }, 5, TimeUnit.MINUTES); // Hardcoded 5 minutes for now
        } else {
            logger.info("Queue is empty. No client to process.");
        }
        notifyQueueChanged(); // Notify change (current client or queue emptiness changed)
    }

    public synchronized void removeClient(String sessionId) {
        boolean removedFromQueue = clientQueue.remove(sessionId);
        if (removedFromQueue) {
            logger.info("Client {} removed from queue.", sessionId);
        }

        if (sessionId.equals(currentClientSessionId)) {
            logger.info("Current client {} disconnected/removed. Processing next.", sessionId);
            currentClientSessionId = null;
            processNextClient(); // This will also call notifyQueueChanged
        } else if (removedFromQueue) {
            // Only notify if removed from queue and was not current,
            // because if it was current, processNextClient already notified.
            notifyQueueChanged();
        }
    }

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
