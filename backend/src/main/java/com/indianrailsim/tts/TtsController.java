package com.indianrailsim.tts;

import com.google.auth.oauth2.GoogleCredentials;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Station PA announcements via Google Cloud Text-to-Speech (natural en-IN voices).
 * Uses Application Default Credentials (Cloud Run service account, or
 * `gcloud auth application-default login` locally). Results are cached in memory,
 * because the same announcements repeat. If TTS is unavailable the endpoint
 * returns 503 and the browser falls back to its own voice.
 */
@RestController
@RequestMapping("/api/tts")
@CrossOrigin(origins = "*")
public class TtsController {

    private static final Logger log = LoggerFactory.getLogger(TtsController.class);
    private static final String ENDPOINT = "https://texttospeech.googleapis.com/v1/text:synthesize";
    private static final Pattern AUDIO = Pattern.compile("\"audioContent\"\\s*:\\s*\"([^\"]+)\"");
    private static final int MAX_TEXT = 600;
    private static final int CACHE_SIZE = 400;

    private final boolean enabled;
    private final String femaleVoice;
    private final String maleVoice;
    private final String quotaProject;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final Map<String, byte[]> cache = java.util.Collections.synchronizedMap(new LinkedHashMap<>(64, 0.75f, true) {
        @Override protected boolean removeEldestEntry(Map.Entry<String, byte[]> e) { return size() > CACHE_SIZE; }
    });
    private volatile GoogleCredentials credentials;
    private volatile String lastError;

    public TtsController(@Value("${railsim.tts.enabled:true}") boolean enabled,
                         @Value("${railsim.tts.female-voice:en-IN-Neural2-A}") String femaleVoice,
                         @Value("${railsim.tts.male-voice:en-IN-Neural2-B}") String maleVoice,
                         @Value("${railsim.tts.quota-project:${GOOGLE_CLOUD_PROJECT:railsimulator-190291}}") String quotaProject) {
        this.enabled = enabled;
        this.femaleVoice = femaleVoice;
        this.maleVoice = maleVoice;
        this.quotaProject = quotaProject;
    }

    public record TtsRequest(String text, String gender) {}

    @GetMapping("/status")
    public Map<String, Object> status() {
        boolean ready = enabled && credentials() != null;
        return Map.of("enabled", enabled, "ready", ready, "voices", List.of(femaleVoice, maleVoice),
                "error", lastError == null ? "" : lastError);
    }

    @PostMapping(produces = "audio/mpeg")
    public ResponseEntity<byte[]> synthesize(@RequestBody TtsRequest req) {
        if (!enabled || req == null || req.text() == null || req.text().isBlank()) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
        String text = req.text().strip();
        if (text.length() > MAX_TEXT) text = text.substring(0, MAX_TEXT);
        boolean male = "male".equalsIgnoreCase(req.gender());
        String voice = male ? maleVoice : femaleVoice;
        String key = voice + "|" + text;
        byte[] cached = cache.get(key);
        if (cached != null) return audio(cached);
        try {
            byte[] mp3 = callGoogle(text, voice);
            cache.put(key, mp3);
            lastError = null;
            return audio(mp3);
        } catch (Exception e) {
            lastError = e.getMessage();
            log.warn("Cloud TTS failed: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).build();
        }
    }

    private ResponseEntity<byte[]> audio(byte[] mp3) {
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("audio/mpeg"))
                .header("Cache-Control", "public, max-age=86400").body(mp3);
    }

    private GoogleCredentials credentials() {
        if (credentials == null) {
            synchronized (this) {
                if (credentials == null) {
                    try {
                        credentials = GoogleCredentials.getApplicationDefault()
                                .createScoped(List.of("https://www.googleapis.com/auth/cloud-platform"));
                    } catch (IOException e) {
                        lastError = "No Google credentials: " + e.getMessage();
                        return null;
                    }
                }
            }
        }
        return credentials;
    }

    private byte[] callGoogle(String text, String voice) throws IOException, InterruptedException {
        GoogleCredentials creds = credentials();
        if (creds == null) throw new IOException(lastError);
        creds.refreshIfExpired();
        String token = creds.getAccessToken().getTokenValue();
        String body = "{\"input\":{\"text\":" + json(text) + "},"
                + "\"voice\":{\"languageCode\":\"en-IN\",\"name\":" + json(voice) + "},"
                + "\"audioConfig\":{\"audioEncoding\":\"MP3\",\"speakingRate\":0.94,\"sampleRateHertz\":24000}}";
        HttpRequest.Builder rb = HttpRequest.newBuilder(URI.create(ENDPOINT))
                .timeout(Duration.ofSeconds(15))
                .header("Authorization", "Bearer " + token)
                .header("Content-Type", "application/json; charset=utf-8")
                .POST(HttpRequest.BodyPublishers.ofString(body));
        if (quotaProject != null && !quotaProject.isBlank()) rb.header("x-goog-user-project", quotaProject);
        HttpResponse<String> res = http.send(rb.build(), HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) {
            String msg = res.body();
            throw new IOException("HTTP " + res.statusCode() + ": " + (msg.length() > 300 ? msg.substring(0, 300) : msg));
        }
        Matcher m = AUDIO.matcher(res.body());
        if (!m.find()) throw new IOException("No audioContent in TTS response");
        return Base64.getDecoder().decode(m.group(1));
    }

    private static String json(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            switch (c) {
                case '"' -> b.append("\\\"");
                case '\\' -> b.append("\\\\");
                case '\n', '\r', '\t' -> b.append(' ');
                default -> { if (c < 0x20) b.append(' '); else b.append(c); }
            }
        }
        return b.append('"').toString();
    }
}
