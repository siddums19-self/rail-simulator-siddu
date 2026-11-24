package com.indianrailsim.auth;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/** Email/password accounts with opaque bearer tokens (stored only as SHA-256 hashes). */
@Service
public class AuthService {
    private static final Pattern EMAIL = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$");
    private static final int MAX_CAREER_CHARS = 64_000;
    private static final SecureRandom RANDOM = new SecureRandom();

    public record User(long id, String email) {}
    public record Session(String token, User user) {}

    private final JdbcTemplate jdbc;

    public AuthService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    public static String normaliseEmail(String raw) {
        String email = raw == null ? "" : raw.trim().toLowerCase(Locale.ROOT);
        if (email.length() > 254 || !EMAIL.matcher(email).matches())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Please enter a valid email address");
        return email;
    }

    private static void requirePassword(String password) {
        if (password == null || password.isEmpty())
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Password is required");
    }

    public Session signup(String rawEmail, String password) {
        String email = normaliseEmail(rawEmail);
        requirePassword(password);
        try {
            jdbc.update("INSERT INTO app_users (email, password_hash) VALUES (?, ?)", email, PasswordHasher.hash(password));
        } catch (DuplicateKeyException e) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "An account with this email already exists — log in instead");
        }
        return openSession(findByEmail(email).orElseThrow());
    }

    public Session login(String rawEmail, String password) {
        String email = normaliseEmail(rawEmail);
        requirePassword(password);
        List<String> hashes = jdbc.queryForList("SELECT password_hash FROM app_users WHERE email = ?", String.class, email);
        if (hashes.isEmpty() || !PasswordHasher.matches(password, hashes.get(0)))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong email or password");
        return openSession(findByEmail(email).orElseThrow());
    }

    /** Resolves "Bearer <token>" to its user, or 401. */
    public User require(String authorization) {
        String token = authorization != null && authorization.startsWith("Bearer ") ? authorization.substring(7).trim() : "";
        if (token.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not logged in");
        List<User> users = jdbc.query(
                "SELECT u.id, u.email FROM user_sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token_hash = ?",
                (rs, i) -> new User(rs.getLong(1), rs.getString(2)), sha256(token));
        if (users.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Session expired — please log in again");
        jdbc.update("UPDATE user_sessions SET last_seen = now() WHERE token_hash = ?", sha256(token));
        return users.get(0);
    }

    public void logout(String authorization) {
        if (authorization != null && authorization.startsWith("Bearer "))
            jdbc.update("DELETE FROM user_sessions WHERE token_hash = ?", sha256(authorization.substring(7).trim()));
    }

    public String career(User user) {
        List<String> rows = jdbc.queryForList("SELECT data_json FROM career_profiles WHERE user_id = ?", String.class, user.id());
        return rows.isEmpty() ? null : rows.get(0);
    }

    public void saveCareer(User user, String json) {
        if (json == null || json.isBlank() || json.length() > MAX_CAREER_CHARS)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid career data");
        jdbc.update("""
                INSERT INTO career_profiles (user_id, data_json, updated_at) VALUES (?, ?, now())
                ON CONFLICT (user_id) DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = now()""", user.id(), json);
    }

    private Optional<User> findByEmail(String email) {
        return jdbc.query("SELECT id, email FROM app_users WHERE email = ?",
                (rs, i) -> new User(rs.getLong(1), rs.getString(2)), email).stream().findFirst();
    }

    private Session openSession(User user) {
        byte[] raw = new byte[32];
        RANDOM.nextBytes(raw);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
        jdbc.update("INSERT INTO user_sessions (token_hash, user_id) VALUES (?, ?)", sha256(token), user.id());
        return new Session(token, user);
    }

    private static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
