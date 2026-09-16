import { useState } from "react";
import { Icon } from "./icons";
import { notify } from "./toast";
import "./Documents.css";

function Documents({ project, onBack }) {
  const [items, setItems] = useState([
    {
      id: 1,
      name: "Structural Drawing - Block A",
      type: "Document",
      category: "Drawings",
      location: "Block A - Floor 3",
      uploadedBy: "Rajesh Patil",
      date: "10 Sep 2026",
      fileName: "structural-drawing-block-a.pdf",
    },
    {
      id: 2,
      name: "Foundation Inspection Report",
      type: "Document",
      category: "Inspection Reports",
      location: "Block A - Foundation",
      uploadedBy: "Amit Sharma",
      date: "09 Sep 2026",
      fileName: "foundation-inspection.pdf",
    },
    {
      id: 3,
      name: "Floor 3 Progress Photo",
      type: "Photo",
      category: "Progress Photos",
      location: "Block A - Floor 3",
      uploadedBy: "Site Supervisor",
      date: "11 Sep 2026",
      fileName: "floor3-progress.jpg",
    },
    {
      id: 4,
      name: "Safety Observation Photo",
      type: "Photo",
      category: "Safety",
      location: "Ground Floor",
      uploadedBy: "Safety Officer",
      date: "10 Sep 2026",
      fileName: "safety-observation.jpg",
    },
    {
      id: 5,
      name: "Material Delivery Invoice",
      type: "Document",
      category: "Materials",
      location: "Material Storage",
      uploadedBy: "Project Manager",
      date: "08 Sep 2026",
      fileName: "cement-invoice.pdf",
    },
  ]);

  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const [newItem, setNewItem] = useState({
    name: "",
    type: "Document",
    category: "Drawings",
    location: "",
    description: "",
    file: null,
    preview: "",
  });

  const handleChange = (e) => {
    setNewItem({
      ...newItem,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];

    if (!file) return;

    let preview = "";

    if (file.type.startsWith("image/")) {
      preview = URL.createObjectURL(file);
    }

    setNewItem({
      ...newItem,
      file,
      preview,
      name: newItem.name || file.name,
    });
  };

  const handleAddItem = (e) => {
    e.preventDefault();

    if (!newItem.name.trim() || !newItem.file) {
      notify("Please enter a name and select a file.", "error");
      return;
    }

    const newDocument = {
      id: Date.now(),
      name: newItem.name,
      type: newItem.type,
      category: newItem.category,
      location: newItem.location || "Site",
      uploadedBy: "Current User",
      date: new Date().toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      fileName: newItem.file.name,
      file: newItem.file,
      preview: newItem.preview,
      description: newItem.description,
    };

    setItems((prev) => [newDocument, ...prev]);

    setNewItem({
      name: "",
      type: "Document",
      category: "Drawings",
      location: "",
      description: "",
      file: null,
      preview: "",
    });

    setShowForm(false);
  };

  const deleteItem = (id) => {
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this item?"
    );

    if (!confirmDelete) return;

    setItems((prev) =>
      prev.filter((item) => item.id !== id)
    );
  };

  const filteredItems = items.filter((item) => {
    const matchesSearch =
      `${item.name} ${item.category} ${item.location} ${item.uploadedBy} ${item.fileName}`
        .toLowerCase()
        .includes(search.toLowerCase());

    const matchesType =
      typeFilter === "All" || item.type === typeFilter;

    const matchesCategory =
      categoryFilter === "All" ||
      item.category === categoryFilter;

    return (
      matchesSearch &&
      matchesType &&
      matchesCategory
    );
  });

  const totalDocuments = items.filter(
    (item) => item.type === "Document"
  ).length;

  const totalPhotos = items.filter(
    (item) => item.type === "Photo"
  ).length;

  const inspectionReports = items.filter(
    (item) => item.category === "Inspection Reports"
  ).length;

  const progressPhotos = items.filter(
    (item) => item.category === "Progress Photos"
  ).length;

  return (
    <div className="documents-page">

      {/* HEADER */}

      <div className="documents-header">

        <div>
          <button
            className="back-project-btn"
            onClick={onBack}
          >
            ← Back to Project
          </button>

          <h1><Icon name="folder" /> Documents & Photos</h1>

          <p>
            {project?.name || "Construction Project"} •
            Manage project documents, drawings, reports and site photos
          </p>
        </div>

        <button
          className="primary-btn document-upload-btn"
          onClick={() => setShowForm(true)}
        >
          + Upload File
        </button>

      </div>

      {/* SUMMARY */}

      <div className="documents-summary">

        <div className="document-stat">
          <div className="document-stat-icon"><Icon name="folder" /></div>
          <span>Total Documents</span>
          <strong>{totalDocuments}</strong>
        </div>

        <div className="document-stat photo-stat">
          <div className="document-stat-icon"><Icon name="camera" /></div>
          <span>Site Photos</span>
          <strong>{totalPhotos}</strong>
        </div>

        <div className="document-stat inspection-stat">
          <div className="document-stat-icon"><Icon name="clipboard" /></div>
          <span>Inspection Reports</span>
          <strong>{inspectionReports}</strong>
        </div>

        <div className="document-stat progress-stat">
          <div className="document-stat-icon"><Icon name="building" /></div>
          <span>Progress Photos</span>
          <strong>{progressPhotos}</strong>
        </div>

      </div>

      {/* UPLOAD FORM */}

      {showForm && (
        <div className="document-card">

          <div className="document-card-header">

            <div>
              <h2>Upload Document / Photo</h2>
              <p>
                Add a project file with construction context
              </p>
            </div>

            <button
              className="close-document-btn"
              onClick={() => setShowForm(false)}
            >
              <Icon name="xmark" />
            </button>

          </div>

          <form
            className="document-form"
            onSubmit={handleAddItem}
          >

            <div className="document-form-group">
              <label>File</label>

              <input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp"
                onChange={handleFileChange}
              />

              {newItem.file && (
                <small className="selected-file">
                  Selected: {newItem.file.name}
                </small>
              )}
            </div>

            <div className="document-form-group">
              <label>File Name / Title</label>

              <input
                name="name"
                value={newItem.name}
                onChange={handleChange}
                placeholder="Example: Floor 3 Progress Report"
              />
            </div>

            <div className="document-form-group">

              <label>Type</label>

              <select
                name="type"
                value={newItem.type}
                onChange={handleChange}
              >
                <option>Document</option>
                <option>Photo</option>
              </select>

            </div>

            <div className="document-form-group">

              <label>Category</label>

              <select
                name="category"
                value={newItem.category}
                onChange={handleChange}
              >
                <option>Drawings</option>
                <option>Reports</option>
                <option>Inspection Reports</option>
                <option>Safety</option>
                <option>Progress Photos</option>
                <option>Materials</option>
                <option>Contracts</option>
                <option>Other</option>
              </select>

            </div>

            <div className="document-form-group">

              <label>Site / Location</label>

              <input
                name="location"
                value={newItem.location}
                onChange={handleChange}
                placeholder="Example: Block A - Floor 3"
              />

            </div>

            <div className="document-form-group full-width">

              <label>Description</label>

              <textarea
                name="description"
                value={newItem.description}
                onChange={handleChange}
                placeholder="Add useful information about this file..."
                rows="4"
              />

            </div>

            {newItem.preview && (
              <div className="document-preview">

                <img
                  src={newItem.preview}
                  alt="Preview"
                />

                <span>
                  Image preview
                </span>

              </div>
            )}

            <div className="document-form-actions">

              <button
                type="button"
                className="cancel-btn"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="primary-btn"
              >
                Upload File
              </button>

            </div>

          </form>

        </div>
      )}

      {/* FILTERS */}

      <div className="document-card">

        <div className="document-toolbar">

          <input
            className="document-search"
            value={search}
            onChange={(e) =>
              setSearch(e.target.value)
            }
            placeholder="Search documents and photos..."
          />

          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value)
            }
          >
            <option>All</option>
            <option>Document</option>
            <option>Photo</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) =>
              setCategoryFilter(e.target.value)
            }
          >
            <option>All</option>
            <option>Drawings</option>
            <option>Reports</option>
            <option>Inspection Reports</option>
            <option>Safety</option>
            <option>Progress Photos</option>
            <option>Materials</option>
            <option>Contracts</option>
            <option>Other</option>
          </select>

        </div>

        {/* FILE LIST */}

        <div className="document-list">

          {filteredItems.length === 0 ? (

            <div className="no-documents">
              <div><Icon name="folder" /></div>
              <h3>No files found</h3>
              <p>
                Try changing your search or filters.
              </p>
            </div>

          ) : (

            filteredItems.map((item) => (

              <div
                className="document-item"
                key={item.id}
              >

                {/* ICON / IMAGE */}

                <div className="document-thumbnail">

                  {item.type === "Photo" &&
                  item.preview ? (

                    <img
                      src={item.preview}
                      alt={item.name}
                    />

                  ) : (

                    <div className="file-icon">
                      {item.type === "Photo" ? (
                        <Icon name="camera" />
                      ) : item.fileName?.endsWith(".pdf") ? (
                        <Icon name="file" />
                      ) : (
                        <Icon name="file" />
                      )}
                    </div>

                  )}

                </div>

                {/* DETAILS */}

                <div className="document-details">

                  <div className="document-title-row">

                    <h3>{item.name}</h3>

                    <span
                      className={`document-type ${item.type.toLowerCase()}`}
                    >
                      {item.type}
                    </span>

                  </div>

                  <p>
                    {item.fileName}
                  </p>

                  <div className="document-meta">

                    <span>
                      <Icon name="folder" /> {item.category}
                    </span>

                    <span>
                      <Icon name="location" /> {item.location}
                    </span>

                    <span>
                      <Icon name="user" /> {item.uploadedBy}
                    </span>

                    <span>
                      <Icon name="calendar" /> {item.date}
                    </span>

                  </div>

                </div>

                {/* ACTIONS */}

                <div className="document-actions">

                  {item.preview && (
                    <button
                      className="view-file-btn"
                      onClick={() =>
                        window.open(
                          item.preview,
                          "_blank"
                        )
                      }
                    >
                      View
                    </button>
                  )}

                  {item.file && (
                    <button
                      className="download-file-btn"
                      onClick={() => {
                        const url =
                          URL.createObjectURL(
                            item.file
                          );

                        const a =
                          document.createElement("a");

                        a.href = url;
                        a.download =
                          item.file.name;

                        a.click();

                        URL.revokeObjectURL(url);
                      }}
                    >
                      Download
                    </button>
                  )}

                  <button
                    className="delete-file-btn"
                    onClick={() =>
                      deleteItem(item.id)
                    }
                  >
                    Delete
                  </button>

                </div>

              </div>

            ))

          )}

        </div>

      </div>

      {/* INFORMATION */}

      <div className="documents-info">

        <div className="documents-info-icon">
          <Icon name="bulb" />
        </div>

        <div>
          <strong>
            Construction Document Management
          </strong>

          <p>
            Keep drawings, inspection reports, safety
            evidence, progress photos and material records
            organized by site location.
          </p>
        </div>

      </div>

    </div>
  );
}

export default Documents;