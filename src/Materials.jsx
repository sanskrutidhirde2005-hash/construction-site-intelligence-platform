import { useState } from "react";
import { actualFromMaterials, formatINR } from "./budget";
import { Icon } from "./icons";
import { notify } from "./toast";
import InventoryForecast from "./InventoryForecast";
import "./Materials.css";

function Materials({ project, onBack }) {
  const [materials, setMaterials] = useState([
    {
      id: 1,
      name: "Cement",
      category: "Concrete",
      required: 500,
      received: 420,
      used: 350,
      unit: "Bags",
      status: "Available",
      cost: 350,
    },
    {
      id: 2,
      name: "Steel",
      category: "Structural",
      required: 120,
      received: 100,
      used: 72,
      unit: "Tons",
      status: "Available",
      cost: 65000,
    },
    {
      id: 3,
      name: "Bricks",
      category: "Masonry",
      required: 50000,
      received: 38000,
      used: 30000,
      unit: "Pieces",
      status: "Low Stock",
      cost: 8,
    },
    {
      id: 4,
      name: "Sand",
      category: "Concrete",
      required: 300,
      received: 250,
      used: 220,
      unit: "Tons",
      status: "Low Stock",
      cost: 4500,
    },
    {
      id: 5,
      name: "Tiles",
      category: "Finishing",
      required: 12000,
      received: 3000,
      used: 500,
      unit: "Pieces",
      status: "Pending",
      cost: 60,
    },
  ]);

  const [showForm, setShowForm] = useState(false);

  const [newMaterial, setNewMaterial] = useState({
    name: "",
    category: "",
    required: "",
    received: "",
    used: "",
    unit: "Bags",
    status: "Available",
    cost: "",
  });

  const [search, setSearch] = useState("");

  const handleChange = (e) => {
    setNewMaterial({
      ...newMaterial,
      [e.target.name]: e.target.value,
    });
  };

  const handleAddMaterial = (e) => {
    e.preventDefault();

    if (!newMaterial.name || !newMaterial.category) {
      notify("Please enter material name and category.", "error");
      return;
    }

    const material = {
      id: Date.now(),
      name: newMaterial.name,
      category: newMaterial.category,
      required: Number(newMaterial.required) || 0,
      received: Number(newMaterial.received) || 0,
      used: Number(newMaterial.used) || 0,
      unit: newMaterial.unit,
      status: newMaterial.status,
      cost: Number(newMaterial.cost) || 0,
    };

    setMaterials([...materials, material]);

    setNewMaterial({
      name: "",
      category: "",
      required: "",
      received: "",
      used: "",
      unit: "Bags",
      status: "Available",
      cost: "",
    });

    setShowForm(false);
  };

  const totalMaterials = materials.length;

  const lowStock = materials.filter(
    (material) => material.status === "Low Stock"
  ).length;

  const pending = materials.filter(
    (material) => material.status === "Pending"
  ).length;

  const totalUsed = materials.reduce(
    (sum, material) => sum + material.used,
    0
  );

  const totalSpent = actualFromMaterials(materials);

  const filteredMaterials = materials.filter((material) =>
    `${material.name} ${material.category}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return (
    <div className="materials-page">

      {/* HEADER */}
      <div className="materials-header">
        <div>
          <button className="back-project-btn" onClick={onBack}>
            ← Back to Project
          </button>

          <h1>Materials Management</h1>

          <p>
            {project.name} • Monitor construction material inventory
          </p>
        </div>

        <button
          className="primary-btn"
          onClick={() => setShowForm(true)}
        >
          + Add Material
        </button>
      </div>

      {/* Phase 8 — live consumption forecast (read-only, backend-computed) */}
      <InventoryForecast projectId={project?.id} />

      {/* ADD MATERIAL FORM */}
      {showForm && (
        <div className="materials-card add-material-card">

          <div className="materials-card-header">
            <div>
              <h2>Add New Material</h2>
              <p>Enter material inventory details</p>
            </div>

            <button
              className="close-form-btn"
              onClick={() => setShowForm(false)}
            >
              <Icon name="xmark" />
            </button>
          </div>

          <form onSubmit={handleAddMaterial} className="material-form">

            <div className="form-group">
              <label>Material Name</label>
              <input
                name="name"
                value={newMaterial.name}
                onChange={handleChange}
                placeholder="Example: Cement"
              />
            </div>

            <div className="form-group">
              <label>Category</label>
              <input
                name="category"
                value={newMaterial.category}
                onChange={handleChange}
                placeholder="Example: Concrete"
              />
            </div>

            <div className="form-group">
              <label>Required Quantity</label>
              <input
                type="number"
                name="required"
                value={newMaterial.required}
                onChange={handleChange}
                placeholder="500"
              />
            </div>

            <div className="form-group">
              <label>Received Quantity</label>
              <input
                type="number"
                name="received"
                value={newMaterial.received}
                onChange={handleChange}
                placeholder="300"
              />
            </div>

            <div className="form-group">
              <label>Used Quantity</label>
              <input
                type="number"
                name="used"
                value={newMaterial.used}
                onChange={handleChange}
                placeholder="100"
              />
            </div>

            <div className="form-group">
              <label>Cost (₹/unit)</label>
              <input
                type="number"
                name="cost"
                value={newMaterial.cost}
                onChange={handleChange}
                placeholder="350"
              />
            </div>

            <div className="form-group">
              <label>Unit</label>

              <select
                name="unit"
                value={newMaterial.unit}
                onChange={handleChange}
              >
                <option>Bags</option>
                <option>Tons</option>
                <option>Pieces</option>
                <option>Kg</option>
                <option>Litres</option>
                <option>Boxes</option>
              </select>
            </div>

            <div className="form-group">
              <label>Status</label>

              <select
                name="status"
                value={newMaterial.status}
                onChange={handleChange}
              >
                <option>Available</option>
                <option>Low Stock</option>
                <option>Pending</option>
              </select>
            </div>

            <div className="form-actions">

              <button
                type="button"
                className="cancel-btn"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>

              <button type="submit" className="primary-btn">
                Add Material
              </button>

            </div>

          </form>
        </div>
      )}

      {/* SUMMARY */}
      <div className="materials-summary">

        <div className="material-stat">
          <span>Total Materials</span>
          <strong>{totalMaterials}</strong>
        </div>

        <div className="material-stat">
          <span>Low Stock</span>
          <strong>{lowStock}</strong>
        </div>

        <div className="material-stat">
          <span>Pending Delivery</span>
          <strong>{pending}</strong>
        </div>

        <div className="material-stat">
          <span>Total Used</span>
          <strong>{totalUsed.toLocaleString()}</strong>
        </div>

        <div className="material-stat">
          <span>Total Spent (materials)</span>
          <strong>{formatINR(totalSpent)}</strong>
        </div>

      </div>

      <p
        style={{ fontSize: "0.85rem", opacity: 0.75, margin: "8px 0 16px" }}
      >
        Budget Prediction uses material cost × used quantity as Actual
        Spent (labour/other costs excluded).
      </p>

      {/* INVENTORY */}
      <div className="materials-card">

        <div className="materials-card-header">

          <div>
            <h2>Material Inventory</h2>
            <p>
              Current stock and consumption across the project
            </p>
          </div>

          <input
            className="material-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search material..."
          />

        </div>

        <div className="material-table">

          <div className="material-row material-heading">
            <span>Material</span>
            <span>Required</span>
            <span>Received</span>
            <span>Used</span>
            <span>Remaining</span>
            <span>Cost/Unit</span>
            <span>Total Value (cost × used)</span>
            <span>Status</span>
          </div>

          {filteredMaterials.length === 0 ? (
            <div className="no-materials">
              No materials found.
            </div>
          ) : (
            filteredMaterials.map((material) => {

              const remaining =
                material.received - material.used;

              return (
                <div
                  className="material-row"
                  key={material.id}
                >

                  <div className="material-name">
                    <strong>{material.name}</strong>
                    <small>{material.category}</small>
                  </div>

                  <span>
                    {material.required.toLocaleString()}{" "}
                    {material.unit}
                  </span>

                  <span>
                    {material.received.toLocaleString()}{" "}
                    {material.unit}
                  </span>

                  <span>
                    {material.used.toLocaleString()}{" "}
                    {material.unit}
                  </span>

                  <strong>
                    {remaining.toLocaleString()}{" "}
                    {material.unit}
                  </strong>

                  <span>
                    {formatINR(material.cost)}
                  </span>

                  <span>
                    {formatINR(
                      (Number(material.cost) || 0) *
                        (Number(material.used) || 0)
                    )}
                  </span>

                  <span
                    className={`material-status ${material.status
                      .toLowerCase()
                      .replace(" ", "-")}`}
                  >
                    {material.status}
                  </span>

                </div>
              );
            })
          )}

        </div>
      </div>

      {/* ALERT */}
      <div className="material-alert">

        <div className="alert-icon"><Icon name="alert" /></div>

        <div>
          <strong>Material Alerts</strong>

          <p>
            {lowStock} materials are running low.
            Check inventory and arrange deliveries.
          </p>
        </div>

        <button>
          View Alerts →
        </button>

      </div>

      {/* DELIVERIES */}
      <div className="materials-card">

        <div className="materials-card-header">
          <div>
            <h2>Upcoming Deliveries</h2>
            <p>Expected material deliveries</p>
          </div>
        </div>

        <div className="delivery-list">

          <div className="delivery-item">

            <span className="delivery-icon">
              <Icon name="truck" />
            </span>

            <div>
              <strong>Tiles</strong>
              <p>
                9,000 Pieces • Supplier: BuildMart
              </p>
            </div>

            <span className="delivery-date">
              18 Sep 2026
            </span>

          </div>

          <div className="delivery-item">

            <span className="delivery-icon">
              <Icon name="truck" />
            </span>

            <div>
              <strong>Cement</strong>
              <p>
                80 Bags • Supplier: UltraBuild
              </p>
            </div>

            <span className="delivery-date">
              20 Sep 2026
            </span>

          </div>

        </div>
      </div>

    </div>
  );
}

export default Materials;