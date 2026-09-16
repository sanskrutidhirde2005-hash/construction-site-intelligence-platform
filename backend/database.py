from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, Text, ForeignKey
from sqlalchemy.sql import func
from . import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    location = Column(String)
    client = Column(String)
    manager = Column(String)
    progress = Column(Integer, default=0)
    status = Column(String, default="Active")
    start_date = Column(DateTime, default=func.now())
    end_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=func.now())


class Inspection(Base):
    __tablename__ = "inspections"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    title = Column(String)
    description = Column(Text, nullable=True)
    status = Column(String, default="Pending")  # Pending, Pass, Fail
    severity = Column(String, default="Medium")  # Low, Medium, High
    detected_at = Column(DateTime, default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    assigned_to = Column(String, nullable=True)


class SafetyIssue(Base):
    __tablename__ = "safety_issues"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    title = Column(String)
    description = Column(Text, nullable=True)
    category = Column(String)  # PPE, Equipment, Environment, Procedure
    severity = Column(String, default="Medium")
    reported_at = Column(DateTime, default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    reported_by = Column(String, nullable=True)


class Material(Base):
    __tablename__ = "materials"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    name = Column(String)
    current_stock = Column(Float, default=0.0)
    minimum_stock = Column(Float, default=10.0)
    unit = Column(String, default="units")
    last_checked = Column(DateTime, default=func.now())


class Risk(Base):
    __tablename__ = "risks"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    title = Column(String)
    description = Column(Text, nullable=True)
    category = Column(String)  # Schedule, Safety, Financial, Resource
    severity = Column(String, default="Medium")
    detected_at = Column(DateTime, default=func.now())
    mitigation_plan = Column(Text, nullable=True)


class GenAIQuery(Base):
    __tablename__ = "genai_queries"

    id = Column(Integer, primary_key=True, index=True)
    query_text = Column(Text)
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=True)
    response_text = Column(Text, nullable=True)
    created_at = Column(DateTime, default=func.now())


class PPEViolation(Base):
    __tablename__ = "ppe_violations"

    id = Column(Integer, primary_key=True, index=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    category = Column(String)  # hard_hat, vest, gloves, mask, footwear
    severity = Column(String, default="High")
    detected_at = Column(DateTime, default=func.now())
    resolved_at = Column(DateTime, nullable=True)
    image_path = Column(String, nullable=True)