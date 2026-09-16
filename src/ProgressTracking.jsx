import { useState } from "react";
import { Icon } from "./icons";

function ProgressTracking({ project, onBack }) {
  const [tasks, setTasks] = useState([
    {
      id: 1,
      name: "Foundation Work",
      phase: "Foundation",
      progress: 100,
      status: "Completed",
    },
    {
      id: 2,
      name: "Ground Floor Structure",
      phase: "Structure",
      progress: 85,
      status: "In Progress",
    },
    {
      id: 3,
      name: "First Floor Structure",
      phase: "Structure",
      progress: 65,
      status: "In Progress",
    },
    {
      id: 4,
      name: "Electrical Installation",
      phase: "MEP",
      progress: 40,
      status: "In Progress",
    },
    {
      id: 5,
      name: "Plumbing Work",
      phase: "MEP",
      progress: 25,
      status: "In Progress",
    },
    {
      id: 6,
      name: "Interior Finishing",
      phase: "Finishing",
      progress: 10,
      status: "Not Started",
    },
  ]);

  const averageProgress = Math.round(
    tasks.reduce((sum, task) => sum + task.progress, 0) /
      tasks.length
  );

  const completedTasks = tasks.filter(
    (task) => task.progress === 100
  ).length;

  return (
    <div className="progress-page">

      {/* HEADER */}
      <div className="progress-header">

        <div>
          <button
            className="back-project-btn"
            onClick={onBack}
          >
            ← Back to Project
          </button>

          <h1>Progress Tracking</h1>

          <p>
            {project.name} • Track construction activities and completion
          </p>
        </div>

        <button className="primary-btn">
          + Add Task
        </button>

      </div>

      {/* SUMMARY */}
      <div className="progress-summary">

        <div className="progress-stat">
          <span>Overall Progress</span>
          <strong>{averageProgress}%</strong>
        </div>

        <div className="progress-stat">
          <span>Total Tasks</span>
          <strong>{tasks.length}</strong>
        </div>

        <div className="progress-stat">
          <span>Completed</span>
          <strong>{completedTasks}</strong>
        </div>

        <div className="progress-stat">
          <span>In Progress</span>
          <strong>
            {tasks.filter(
              (task) => task.status === "In Progress"
            ).length}
          </strong>
        </div>

      </div>

      {/* PROJECT PROGRESS */}
      <div className="progress-main-card">

        <div className="progress-card-title">
          <div>
            <h2>Construction Progress</h2>
            <p>Current status of project activities</p>
          </div>

          <strong>{averageProgress}%</strong>
        </div>

        <div className="large-progress-bar">
          <div
            style={{
              width: `${averageProgress}%`,
            }}
          ></div>
        </div>

      </div>

      {/* TASKS */}
      <div className="tasks-card">

        <div className="tasks-header">
          <h2>Construction Tasks</h2>

          <select>
            <option>All Phases</option>
            <option>Foundation</option>
            <option>Structure</option>
            <option>MEP</option>
            <option>Finishing</option>
          </select>
        </div>

        <div className="task-table">

          <div className="task-row task-heading">
            <span>Task</span>
            <span>Phase</span>
            <span>Progress</span>
            <span>Status</span>
          </div>

          {tasks.map((task) => (

            <div
              className="task-row"
              key={task.id}
            >

              <strong>
                {task.name}
              </strong>

              <span>
                {task.phase}
              </span>

              <div className="task-progress">

                <div className="task-progress-bar">
                  <div
                    style={{
                      width: `${task.progress}%`,
                    }}
                  ></div>
                </div>

                <small>
                  {task.progress}%
                </small>

              </div>

              <span
                className={`task-status ${
                  task.status === "Completed"
                    ? "completed"
                    : task.status === "In Progress"
                    ? "in-progress"
                    : "not-started"
                }`}
              >
                {task.status}
              </span>

            </div>

          ))}

        </div>

      </div>

      {/* RECENT UPDATES */}
      <div className="updates-card">

        <h2>Recent Site Updates</h2>

        <div className="update-item">
          <span><Icon name="calendar" /></span>

          <div>
            <strong>
              Ground Floor Structure updated
            </strong>

            <p>
              Progress increased to 85%
            </p>

            <small>
              Today • Site Supervisor
            </small>
          </div>
        </div>

        <div className="update-item">
          <span><Icon name="camera" /></span>

          <div>
            <strong>
              Site photos uploaded
            </strong>

            <p>
              12 new construction photos added
            </p>

            <small>
              Yesterday • Site Supervisor
            </small>
          </div>
        </div>

      </div>

    </div>
  );
}

export default ProgressTracking;