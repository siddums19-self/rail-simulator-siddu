package com.indianrailsim.auth;

import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class AuthController {
    public record Credentials(String email, String password) {}
    public record SessionResponse(String token, String email, String career) {}

    private final AuthService auth;

    public AuthController(AuthService auth) { this.auth = auth; }

    @PostMapping("/auth/signup")
    public SessionResponse signup(@RequestBody Credentials c) {
        AuthService.Session s = auth.signup(c.email(), c.password());
        return new SessionResponse(s.token(), s.user().email(), null);
    }

    @PostMapping("/auth/login")
    public SessionResponse login(@RequestBody Credentials c) {
        AuthService.Session s = auth.login(c.email(), c.password());
        return new SessionResponse(s.token(), s.user().email(), auth.career(s.user()));
    }

    @GetMapping("/auth/me")
    public SessionResponse me(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authz) {
        AuthService.User u = auth.require(authz);
        return new SessionResponse(null, u.email(), auth.career(u));
    }

    @PostMapping("/auth/logout")
    public Map<String, Boolean> logout(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authz) {
        auth.logout(authz);
        return Map.of("ok", true);
    }

    /** The career is an opaque JSON document owned by the client. */
    @PutMapping(value = "/career", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Boolean>> saveCareer(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String authz,
                                                           @RequestBody String json) {
        auth.saveCareer(auth.require(authz), json);
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
