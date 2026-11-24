package com.indianrailsim.repository;

import com.indianrailsim.model.RailHub;
import org.springframework.data.jpa.repository.JpaRepository;

public interface HubRepository extends JpaRepository<RailHub, String> {
}
