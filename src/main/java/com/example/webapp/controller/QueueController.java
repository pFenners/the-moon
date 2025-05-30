package com.example.webapp.controller;

import com.example.webapp.service.QueueService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import jakarta.servlet.http.HttpSession; // For session management
import java.util.HashMap;
import java.util.Map;

@RestController
public class QueueController {

    private final QueueService queueService;

    @Autowired
    public QueueController(QueueService queueService) {
        this.queueService = queueService;
    }

    @PostMapping("/join-queue")
    public ResponseEntity<?> joinQueue(HttpSession session) {
        String sessionId = session.getId();
        boolean added = queueService.addClient(sessionId);
        Map<String, Object> response = new HashMap<>();
        response.put("sessionId", sessionId);

        if (added) {
            int position = queueService.getClientPosition(sessionId);
            response.put("message", "Successfully joined the queue.");
            response.put("position", position);
            response.put("isCurrent", queueService.getCurrentClient() != null && queueService.getCurrentClient().equals(sessionId));
            return ResponseEntity.ok(response);
        } else {
            int position = queueService.getClientPosition(sessionId);
            response.put("message", "Already in queue or currently active.");
            response.put("position", position);
            response.put("isCurrent", queueService.getCurrentClient() != null && queueService.getCurrentClient().equals(sessionId));
            return ResponseEntity.status(409).body(response); // 409 Conflict
        }
    }

    @GetMapping("/queue-status")
    public ResponseEntity<?> queueStatus(HttpSession session) {
        String sessionId = session.getId();
        int position = queueService.getClientPosition(sessionId);
        String currentClient = queueService.getCurrentClient();
        boolean isCurrent = currentClient != null && currentClient.equals(sessionId);

        Map<String, Object> response = new HashMap<>();
        response.put("sessionId", sessionId);
        response.put("position", position);
        response.put("isCurrent", isCurrent);
        response.put("currentClientSessionId", currentClient); // For debugging or advanced client logic
        response.put("queueSize", queueService.getQueueSize());


        if (position == -1 && !isCurrent) {
             response.put("message", "You are not in the queue.");
        } else if (isCurrent) {
            response.put("message", "You are currently the active client.");
        } else {
            response.put("message", "You are in the queue.");
        }

        return ResponseEntity.ok(response);
    }
}
