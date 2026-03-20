// Import required libraries
import React from 'react';
import { Line, Bar, Pie } from 'react-chartjs-2';

// Define the StatsPage component
const StatsPage = () => {
  // Sample data for population over time
  const populationData = {
    labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'],
    datasets: [
      {
        label: 'Population',
        data: [10, 20, 30, 40, 50],
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1
      }
    ]
  };

  // Sample data for faction sizes
  const factionData = {
    labels: ['Faction 1', 'Faction 2', 'Faction 3'],
    datasets: [
      {
        label: 'Faction Sizes',
        data: [10, 20, 30],
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(54, 162, 235, 0.2)',
          'rgba(255, 206, 86, 0.2)'
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)'
        ],
        borderWidth: 1
      }
    ]
  };

  // Sample data for gold distribution
  const goldData = {
    labels: ['Agent 1', 'Agent 2', 'Agent 3'],
    datasets: [
      {
        label: 'Gold Distribution',
        data: [10, 20, 30],
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(54, 162, 235, 0.2)',
          'rgba(255, 206, 86, 0.2)'
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)'
        ],
        borderWidth: 1
      }
    ]
  };

  // Sample data for books per day
  const booksData = {
    labels: ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'],
    datasets: [
      {
        label: 'Books per Day',
        data: [1, 2, 3, 4, 5],
        backgroundColor: 'rgba(255, 99, 132, 0.2)',
        borderColor: 'rgba(255, 99, 132, 1)',
        borderWidth: 1
      }
    ]
  };

  // Sample data for wars
  const warsData = {
    labels: ['War 1', 'War 2', 'War 3'],
    datasets: [
      {
        label: 'Wars',
        data: [1, 2, 3],
        backgroundColor: [
          'rgba(255, 99, 132, 0.2)',
          'rgba(54, 162, 235, 0.2)',
          'rgba(255, 206, 86, 0.2)'
        ],
        borderColor: [
          'rgba(255, 99, 132, 1)',
          'rgba(54, 162, 235, 1)',
          'rgba(255, 206, 86, 1)'
        ],
        borderWidth: 1
      }
    ]
  };

  return (
    <div>
      <h1>World Statistics</h1>
      <Line data={populationData} />
      <Bar data={factionData} />
      <Pie data={goldData} />
      <Line data={booksData} />
      <Bar data={warsData} />
    </div>
  );
};

export default StatsPage;