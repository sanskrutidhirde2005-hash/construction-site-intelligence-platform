from typing import List, Optional
from pydantic import BaseModel, Field


# Project schemas
class ProjectCreate(BaseModel):
    name: str = Field(..., description="Project name")
    location: str = Field(..., description="Project location")
    client: str = Field(..., description="Client/company name")
    manager: str = Field(..., description="Project manager name")


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    location: Optional[str] = None
    client: Optional[str] = None
    manager: Optional[str] = None
    progress: Optional[int] = None
    status: Optional[str] = None


class ProjectRead(ProjectCreate):
    id: int
    created_at: Optional[datetime] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None

    class ProjectReadConfig:
        pass

    model_config = {"from_attributes": True}


# Inspection schemas
class InspectionCreate(BaseModel):
    project_id: int = Field(..., description="Project ID")
    title: str = Field(..., description="Inspection title")
    description: Optional[str] = Field(None, description="Inspection description")
    status: Optional[str] = Field("Pending", description="Status: Pending, Pass, Fail")
    severity: Optional[str] = Field("Medium", description="Severity: Low, Medium, High")


class InspectionUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    severity: Optional[str] = None


class InspectionRead(InspectionCreate):
    id: int
    detected_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    assigned_to: Optional[str] = None

    model_config = {"from_attributes": True}


# Safety Issue schemas
class SafetyIssueCreate(BaseModel):
    project_id: int = Field(..., description="Project ID")
    title: str = Field(..., description="Safety issue title")
    description: Optional[str] = Field(None, description="Description")
    category: Optional[str] = Field(None, description="Category: PPE, Equipment, Environment, Procedure")
    severity: Optional[str] = Field("Medium", description="Severity: Low, Medium, High")


class SafetyIssueUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    resolved: Optional[bool] = None


class SafetyIssueRead(SafetyIssueCreate):
    id: int
    reported_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    reported_by: Optional[str] = None

    model_config = {"from_attributes": True}


# Material schemas
class MaterialCreate(BaseModel):
    project_id: int = Field(..., description="Project ID")
    name: str = Field(..., description="Material name")
    current_stock: float = Field(0.0, ge=0, description="Current stock level")
    minimum_stock: float = Field(10.0, ge=0, description="Minimum stock threshold")
    unit: str = Field("units", description="Unit of measure")


class MaterialUpdate(BaseModel):
    current_stock: Optional[float] = None
    minimum_stock: Optional[float] = None


class MaterialRead(MaterialCreate):
    id: int
    last_checked: Optional[datetime] = None

    model_config = {"from_attributes": True}


# Risk schemas
class RiskCreate(BaseModel):
    project_id: int = Field(..., description="Project ID")
    title: str = Field(..., description="Risk title")
    description: Optional[str] = Field(None, description="Risk description")
    category: Optional[str] = Field(None, description="Category: Schedule, Safety, Financial, Resource")
    severity: Optional[str] = Field("Medium", description="Severity: Low, Medium, High")
    mitigation_plan: Optional[str] = Field(None, description="Mitigation plan")


class RiskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    severity: Optional[str] = None
    mitigation_plan: Optional[str] = None


class RiskRead(RiskCreate):
    id: int
    detected_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# GenAI Query schemas
class GenAIQueryCreate(BaseModel):
    query_text: str = Field(..., description="User query text")
    project_id: Optional[int] = Field(None, description="Related project ID")


class GenAIQueryUpdate(BaseModel):
    response_text: Optional[str] = Field(None, description="Generated response")


class GenAIQueryRead(GenAIQueryCreate):
    id: int
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


# PPE Violation schemas
class PPEViolationCreate(BaseModel):
    project_id: int = Field(..., description="Project ID")
    category: str = Field(..., description="PPE category: hard_hat, vest, gloves, mask, footwear")
    severity: Optional[str] = Field("High", description="Severity: High, Medium, Low")
    image_path: Optional[str] = Field(None, description="Path to detection image")


class PPEViolationUpdate(BaseModel):
    severity: Optional[str] = None
    resolved: Optional[bool] = None


class PPEViolationRead(PPEViolationCreate):
    id: int
    detected_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None

    model_config = {"from_attributes": True}