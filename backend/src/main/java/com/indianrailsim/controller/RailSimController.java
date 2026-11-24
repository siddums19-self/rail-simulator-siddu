package com.indianrailsim.controller;

import com.indianrailsim.model.CustomRoster;
import com.indianrailsim.model.RailHub;
import com.indianrailsim.repository.HubRepository;
import com.indianrailsim.repository.RosterRepository;
import com.indianrailsim.service.RoutePathfinderService;
import com.indianrailsim.service.RoutePathfinderService.SolvedRoute;
import com.indianrailsim.service.TrafficCrossingService;
import com.indianrailsim.service.TrafficCrossingService.CrossingEvent;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class RailSimController {

    private final HubRepository hubRepo;
    private final RosterRepository rosterRepo;
    private final RoutePathfinderService pathfinder;
    private final TrafficCrossingService trafficService;

    public RailSimController(HubRepository hubRepo, RosterRepository rosterRepo,
                             RoutePathfinderService pathfinder, TrafficCrossingService trafficService) {
        this.hubRepo = hubRepo;
        this.rosterRepo = rosterRepo;
        this.pathfinder = pathfinder;
        this.trafficService = trafficService;
    }

    public record RouteSolveRequest(String source, String dest, List<String> viaHubs, Boolean allStopsPassenger) {}
    public record SimulationPlan(SolvedRoute route, List<CrossingEvent> crossings) {}

    @GetMapping("/hubs")
    public List<RailHub> getAllHubs() {
        return hubRepo.findAll();
    }

    @PostMapping("/routes/solve")
    public SimulationPlan solveAndGenerateTraffic(@RequestBody RouteSolveRequest req) {
        boolean allStops = Boolean.TRUE.equals(req.allStopsPassenger());
        SolvedRoute route = pathfinder.solveRoute(req.source(), req.dest(), req.viaHubs(), allStops);
        List<CrossingEvent> crossings = trafficService.generateCrossings(route);
        return new SimulationPlan(route, crossings);
    }

    @GetMapping("/rosters")
    public List<CustomRoster> listRosters() {
        return rosterRepo.findAll();
    }

    @PostMapping("/rosters")
    public CustomRoster saveRoster(@RequestBody CustomRoster roster) {
        return rosterRepo.save(roster);
    }
}
