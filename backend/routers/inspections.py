from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select, or_
from typing import List, Optional
from datetime import datetime

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["inspections"])


@router.get("/", response_model=List[schemas.InspectionRead])
async def list_inspections(
    project_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """List inspections, optionally filtered by project_id."""
    query = select(models.Inspection)
    if project_id:
        query = query.where(models.Inspection.project_id == project_id)
    result = session.execute(query.order_by(models.Inspection.detected_at.desc()))
    inspections = result.scalars().all()
    return inspections


@router.post("/", response_model=schemas.InspectionRead, status_code=201)
async def create_inspection(inspection: schemas.InspectionCreate, session: Session = Depends(get_session)):
    """Create a new inspection."""
    # Verify project exists
    proj_result = session.execute(select(models.Project).where(models.Project.id == inspection.project_id))
    proj = proj_result.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_inspection = models.Inspection(
        project_id=inspection.project_id,
        title=inspection.title,
        description=inspection.description,
        status=inspection.status or "Pending",
        severity=inspection.severity or "Medium",
    )
    session.add(db_inspection)
    session.commit()
    session.refresh(db_inspection)
    return db_inspection


@router.get("/{inspection_id}", response_model=schemas.InspectionRead)
async def get_inspection(inspection_id: int, session: Session = Depends(get_session)):
    """Get a single inspection by ID."""
    result = session.execute(select(models.Inspection).where(models.Inspection.id == inspection_id))
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    return inspection


@router.put("/{inspection_id}", response_model=schemas.InspectionRead)
async def update_inspection(
    inspection_id: int, 
    inspection_update: schemas.InspectionUpdate, 
    session: Session = Depends(get_session)
):
    """Update an inspection."""
    result = session.execute(select(models.Inspection).where(models.Inspection.id == inspection_id))
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    
    update_data = inspection_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(inspection, field, value)
    
    session.add(inspection)
    session.commit()
    session.refresh(inspection)
    return inspection


@router.delete("/{inspection_id}", status_code=204)
async def delete_inspection(inspection_id: int, session: Session = Depends(get_session)):
    """Delete an inspection."""
    result = session.execute(select(models.Inspection).where(models.Inspection.id == inspection_id))
    inspection = result.scalar_one_or_none()
    if not inspection:
        raise HTTPException(status_code=404, detail="Inspection not found")
    session.delete(inspection)
    session.commit()
    return None