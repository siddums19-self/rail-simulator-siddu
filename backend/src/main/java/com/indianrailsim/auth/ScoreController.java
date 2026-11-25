package com.indianrailsim.auth;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;
import java.util.Set;

/** Finished games of every mode and the daily / weekly / monthly top-10 leaderboards. */
@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class ScoreController {
    public record ScoreRequest(String playerName, String mode, String venue, Integer score, Integer trains, Double avgDelay) {}
    public record ScoreRow(String playerName, String mode, String venue, int score, int trains, Double avgDelay, boolean guest, String playedAt) {}

    private static final Set<String> MODES = Set.of("drive", "station", "controller", "wayside", "daily");
    private static final Map<String, String> PERIODS = Map.of("daily", "1 day", "weekly", "7 days", "monthly", "30 days");

    private final JdbcTemplate jdbc;
    private final AuthService auth;

    public ScoreController(JdbcTemplate jdbc, AuthService auth) { this.jdbc = jdbc; this.auth = auth; }

    @PostMapping("/scores")
    public Map<String, Boolean> post(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authz,
                                     @RequestBody ScoreRequest r) {
        if (r == null || r.mode() == null || !MODES.contains(r.mode()) || r.score() == null)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "mode and score are required");
        AuthService.User user = null;
        if (authz != null && !authz.isBlank()) {
            try { user = auth.require(authz); } catch (ResponseStatusException e) { /* expired session: post as guest */ }
        }
        String name = user != null ? user.email().split("@")[0] : clean(r.playerName());
        if (name.isEmpty()) name = "Guest";
        int score = Math.max(-100000, Math.min(1000000, r.score()));
        int trains = r.trains() == null ? 0 : Math.max(0, Math.min(100000, r.trains()));
        jdbc.update("INSERT INTO game_scores (user_id, player_name, mode, venue, score, trains, avg_delay, guest) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                user == null ? null : user.id(), name, r.mode(), clean(r.venue()), score, trains, r.avgDelay(), user == null);
        return Map.of("ok", true);
    }

    @GetMapping("/leaderboard")
    public List<ScoreRow> leaderboard(@RequestParam String mode, @RequestParam(defaultValue = "daily") String period) {
        if (!MODES.contains(mode)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown mode");
        String interval = PERIODS.getOrDefault(period, "1 day"); // whitelisted, safe to inline
        return jdbc.query(
                "SELECT player_name, mode, venue, score, trains, avg_delay, guest, played_at FROM game_scores "
                        + "WHERE mode = ? AND played_at >= now() - interval '" + interval + "' ORDER BY score DESC, played_at ASC LIMIT 10",
                (rs, i) -> new ScoreRow(rs.getString(1), rs.getString(2), rs.getString(3), rs.getInt(4), rs.getInt(5),
                        rs.getObject(6) == null ? null : rs.getDouble(6), rs.getBoolean(7), rs.getTimestamp(8).toInstant().toString()),
                mode);
    }

    private static String clean(String s) {
        if (s == null) return "";
        String t = s.replaceAll("[\\p{Cntrl}<>]", "").trim();
        return t.length() > 30 ? t.substring(0, 30) : t;
    }
}
