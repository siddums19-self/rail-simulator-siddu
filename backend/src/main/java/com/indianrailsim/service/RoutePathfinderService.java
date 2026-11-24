package com.indianrailsim.service;

import com.indianrailsim.model.CorridorEdge;
import com.indianrailsim.model.RailHub;
import com.indianrailsim.repository.EdgeRepository;
import com.indianrailsim.repository.HubRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;

import java.util.*;

@Service
public class RoutePathfinderService {

    private final HubRepository hubRepo;
    private final EdgeRepository edgeRepo;

    public RoutePathfinderService(HubRepository hubRepo, EdgeRepository edgeRepo) {
        this.hubRepo = hubRepo;
        this.edgeRepo = edgeRepo;
    }

    public record SolvedLeg(
        String edgeId, String from, String to, boolean reversed,
        double distanceKm, String trackType, String biome,
        List<StationNode> stations, String specialGeometryJson
    ) {}

    public record StationNode(
        String code, int platforms, boolean defaultHalt, boolean mandatoryReversal
    ) {}

    public record SolvedRoute(
        double totalRealKm, double compressedMinutes, List<SolvedLeg> legs
    ) {}

    private record Adj(String neighbor, CorridorEdge edge, boolean reversed) {}

    public SolvedRoute solveRoute(String source, String dest, List<String> viaHubs, boolean allStopsPassenger) {
        if (source == null || dest == null || source.isBlank() || dest.isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Source and destination hub codes are required.");
        }
        if (source.equalsIgnoreCase(dest)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Source and destination must be different hubs.");
        }

        Map<String, RailHub> hubMap = new HashMap<>();
        hubRepo.findAll().forEach(h -> hubMap.put(h.code, h));

        Map<String, List<Adj>> graph = new HashMap<>();
        for (CorridorEdge e : edgeRepo.findAll()) {
            graph.computeIfAbsent(e.fromHub, k -> new ArrayList<>()).add(new Adj(e.toHub, e, false));
            graph.computeIfAbsent(e.toHub, k -> new ArrayList<>()).add(new Adj(e.fromHub, e, true));
        }

        List<String> waypoints = new ArrayList<>();
        waypoints.add(source.trim().toUpperCase());
        if (viaHubs != null) {
            viaHubs.stream()
                .filter(v -> v != null && !v.isBlank())
                .flatMap(v -> Arrays.stream(v.split(",")))
                .map(String::trim)
                .filter(v -> !v.isBlank())
                .map(String::toUpperCase)
                .forEach(waypoints::add);
        }
        waypoints.add(dest.trim().toUpperCase());

        List<SolvedLeg> legs = new ArrayList<>();
        double totalKm = 0;

        for (int i = 0; i < waypoints.size() - 1; i++) {
            String legStart = waypoints.get(i);
            String legEnd = waypoints.get(i + 1);
            if (legStart.equals(legEnd)) continue;

            List<Adj> legPath = dijkstra(graph, legStart, legEnd);
            if (legPath.isEmpty()) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "No connected railway path found between " + legStart + " and " + legEnd);
            }

            for (Adj step : legPath) {
                CorridorEdge e = step.edge();
                List<String> raw = new ArrayList<>(Arrays.asList(e.stationsCsv.split(",")));
                if (step.reversed()) Collections.reverse(raw);

                List<StationNode> nodes = raw.stream().map(s -> {
                    boolean skip = s.endsWith("*");
                    String code = skip ? s.substring(0, s.length() - 1) : s;
                    RailHub hub = hubMap.get(code);
                    int pf = (hub != null) ? hub.platforms : (skip ? 2 : 3);
                    boolean rev = hub != null && hub.mandatoryReversal
                            && !code.equalsIgnoreCase(source) && !code.equalsIgnoreCase(dest);
                    boolean halt = allStopsPassenger || !skip;
                    return new StationNode(code, pf, halt, rev);
                }).toList();

                String legFrom = step.reversed() ? e.toHub : e.fromHub;
                String legTo = step.reversed() ? e.fromHub : e.toHub;
                legs.add(new SolvedLeg(e.edgeId, legFrom, legTo, step.reversed(),
                        e.distanceKm, e.trackType, e.biome, nodes, e.specialGeometryJson));
                totalKm += e.distanceKm;
            }
        }
        double pacePer200Km = allStopsPassenger ? 17.0 : 12.0;
        double compressedMinutes = Math.round((totalKm / 200.0) * pacePer200Km * 10.0) / 10.0;
        return new SolvedRoute(totalKm, compressedMinutes, legs);
    }

    private List<Adj> dijkstra(Map<String, List<Adj>> graph, String start, String end) {
        Map<String, Double> dist = new HashMap<>();
        Map<String, Adj> prevEdge = new HashMap<>();
        Map<String, String> prevNode = new HashMap<>();
        PriorityQueue<String> pq = new PriorityQueue<>(
            Comparator.comparingDouble(n -> dist.getOrDefault(n, Double.MAX_VALUE))
        );

        dist.put(start, 0.0);
        pq.add(start);

        while (!pq.isEmpty()) {
            String curr = pq.poll();
            if (curr.equals(end)) break;
            for (Adj adj : graph.getOrDefault(curr, List.of())) {
                double nd = dist.get(curr) + adj.edge().distanceKm;
                if (nd < dist.getOrDefault(adj.neighbor(), Double.MAX_VALUE)) {
                    dist.put(adj.neighbor(), nd);
                    prevEdge.put(adj.neighbor(), adj);
                    prevNode.put(adj.neighbor(), curr);
                    pq.add(adj.neighbor());
                }
            }
        }

        List<Adj> path = new ArrayList<>();
        String cur = end;
        while (prevEdge.containsKey(cur)) {
            path.add(prevEdge.get(cur));
            cur = prevNode.get(cur);
        }
        Collections.reverse(path);
        return path;
    }
}
