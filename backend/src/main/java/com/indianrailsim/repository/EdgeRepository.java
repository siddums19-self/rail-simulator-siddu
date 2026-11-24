package com.indianrailsim.repository;

import com.indianrailsim.model.CorridorEdge;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EdgeRepository extends JpaRepository<CorridorEdge, String> {
}
