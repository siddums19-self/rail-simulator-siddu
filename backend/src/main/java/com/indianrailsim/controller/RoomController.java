package com.indianrailsim.controller;

import org.springframework.http.HttpStatus;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Multiplayer rooms (in memory). The owner creates a room with a 4-digit code and the route; others join
 * with the code. Every player posts its progress about once a second and gets everyone's back (polling).
 * Rooms are dropped after 3 hours without activity.
 */
@RestController
@RequestMapping("/api/rooms")
@CrossOrigin(origins = "*")
public class RoomController {
    public record CreateRequest(String code, String owner, String mode, Map<String, Object> route) {}
    public record JoinRequest(String name) {}
    public record PlayerState(String name, double km, double totalKm, double speed, int score, double late, boolean done, String status) {}
    public record Room(String code, String owner, String mode, Map<String, Object> route, boolean started, long createdAt, Collection<PlayerState> players) {}

    private static final class RoomData {
        final String code, owner, mode; final Map<String, Object> route; final long createdAt = Instant.now().toEpochMilli();
        volatile boolean started; volatile long touched = createdAt;
        final Map<String, PlayerState> players = new ConcurrentHashMap<>();
        RoomData(String code, String owner, String mode, Map<String, Object> route) { this.code = code; this.owner = owner; this.mode = mode; this.route = route; }
        Room view() { return new Room(code, owner, mode, route, started, createdAt, players.values()); }
    }

    private final Map<String, RoomData> rooms = new ConcurrentHashMap<>();

    private static String name(String raw) {
        String n = raw == null ? "" : raw.replaceAll("[\\p{Cntrl}<>]", "").trim();
        if (n.isEmpty()) n = "Player";
        return n.length() > 24 ? n.substring(0, 24) : n;
    }
    private RoomData room(String code) {
        RoomData r = rooms.get(code);
        if (r == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "No room with code " + code);
        r.touched = Instant.now().toEpochMilli();
        return r;
    }

    @PostMapping
    public Room create(@RequestBody CreateRequest req) {
        if (req == null || req.code() == null || !req.code().matches("\\d{4}"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Choose a 4-digit room code");
        String owner = name(req.owner());
        RoomData r = new RoomData(req.code(), owner, req.mode() == null ? "race" : req.mode(), req.route() == null ? Map.of() : req.route());
        if (rooms.putIfAbsent(req.code(), r) != null) throw new ResponseStatusException(HttpStatus.CONFLICT, "Room " + req.code() + " is in use — pick another code");
        r.players.put(owner, new PlayerState(owner, 0, 0, 0, 0, 0, false, "owner"));
        return r.view();
    }

    @PostMapping("/{code}/join")
    public Room join(@PathVariable String code, @RequestBody JoinRequest req) {
        RoomData r = room(code);
        String n = name(req == null ? null : req.name());
        if (r.players.size() >= 8 && !r.players.containsKey(n)) throw new ResponseStatusException(HttpStatus.CONFLICT, "Room is full (8 players)");
        r.players.putIfAbsent(n, new PlayerState(n, 0, 0, 0, 0, 0, false, "joined"));
        return r.view();
    }

    @PostMapping("/{code}/start")
    public Room start(@PathVariable String code) { RoomData r = room(code); r.started = true; return r.view(); }

    @PostMapping("/{code}/state")
    public Room state(@PathVariable String code, @RequestBody PlayerState s) {
        RoomData r = room(code);
        String n = name(s.name());
        r.players.put(n, new PlayerState(n, s.km(), s.totalKm(), s.speed(), s.score(), s.late(), s.done(), s.status()));
        return r.view();
    }

    @GetMapping("/{code}")
    public Room get(@PathVariable String code) { return room(code).view(); }

    @PostMapping("/{code}/leave")
    public Map<String, Boolean> leave(@PathVariable String code, @RequestBody JoinRequest req) {
        RoomData r = rooms.get(code);
        if (r != null) { r.players.remove(name(req == null ? null : req.name())); if (r.players.isEmpty()) rooms.remove(code); }
        return Map.of("ok", true);
    }

    @Scheduled(fixedRate = 600_000)
    public void sweep() {
        long cut = Instant.now().toEpochMilli() - 3 * 3600_000L;
        rooms.values().removeIf((r) -> r.touched < cut);
    }
}
