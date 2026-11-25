package com.indianrailsim.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/** Station Master mode: the real trains that pass a station (rotated by the game at the station's flow). */
@RestController
@RequestMapping("/api/sm")
@CrossOrigin(origins = "*")
public class StationMasterController {
    public record StationTrain(String trainNo, String trainName, String kind, String fromLine, String toLine, boolean reverses) {}

    private final JdbcTemplate jdbc;

    public StationMasterController(JdbcTemplate jdbc) { this.jdbc = jdbc; }

    @GetMapping("/trains")
    public List<StationTrain> trains(@RequestParam String station) {
        return jdbc.query(
                "SELECT train_no, train_name, kind, from_line, to_line, reverses FROM sm_station_trains WHERE station_code = ? ORDER BY id",
                (rs, i) -> new StationTrain(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getBoolean(6)),
                station.trim().toUpperCase());
    }
}
