package com.indianrailsim.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "corridor_edges")
public class CorridorEdge {
    @Id
    @Column(name = "edge_id")
    public String edgeId;

    @Column(name = "from_hub")
    public String fromHub;

    @Column(name = "to_hub")
    public String toHub;

    @Column(name = "distance_km")
    public double distanceKm;

    @Column(name = "track_type")
    public String trackType;

    public String biome;

    @Column(name = "stations_csv")
    public String stationsCsv;

    @Column(name = "special_geometry_json")
    public String specialGeometryJson;
}
