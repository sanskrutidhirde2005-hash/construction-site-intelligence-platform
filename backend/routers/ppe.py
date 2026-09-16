from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["ppe"])


@router.get("/", response_model=List[schemas.PPEViolationRead])
async def list_ppe_violations(
    project_id: Optional[int] = None,
    severity: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """List PPE violations, optionally filtered by project_id and severity."""
    query = select(models.PPEViolation)
    if project_id:
        query = query.where(models.PPEViolation.project_id == project_id)
    if severity:
        query = query.where(models.PPEViolation.severity == severity)
    result = session.execute(query.order_by(models.PPEViolation.detected_at.desc()))
    violations = result.scalars().all()
    return violations


@router.post("/", response_model=schemas.PPEViolationRead, status_code=201)
async def create_ppe_violation(violation: schemas.PPEViolationCreate, session: Session = Depends(get_session)):
    """Create a new PPE violation record."""
    # Verify project exists
    proj_result = session.execute(
        select(models.Project).where(models.Project.id == violation.project_id)
    )
    proj = proj_result.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_violation = models.PPEViolation(
        project_id=violation.project_id,
        category=violation.category,
        severity=violation.severity or "High",
        image_path=violation.image_path,
    )
    session.add(db_violation)
    session.commit()
    session.refresh(db_violation)
    return db_violation


@router.get("/{violation_id}", response_model=schemas.PPEViolationRead)
async def get_ppe_violation(violation_id: int, session: Session = Depends(get_session)):
    """Get a single PPE violation by ID."""
    result = session.execute(
        select(models.PPEViolation).where(models.PPEViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    if not violation:
        raise HTTPException(status_code=404, detail="PPE violation not found")
    return violation


@router.put("/{violation_id}", response_model=schemas.PPEViolationRead)
async def update_ppe_violation(
    violation_id: int,
    violation_update: schemas.PPEViolationUpdate,
    session: Session = Depends(get_session)
):
    """Update a PPE violation."""
    result = session.execute(
        select(models.PPEViolation).where(models.PPEViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    if not violation:
        raise HTTPException(status_code=404, detail="PPE violation not found")
    
    update_data = violation_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(violation, field, value)
    
    session.add(violation)
    session.commit()
    session.refresh(violation)
    return violation


@router.put("/{violation_id}/resolve", response_model=schemas.PPEViolationRead)
async def resolve_ppe_violation(
    violation_id: int,
    session: Session = Depends(get_session)
):
    """Resolve a PPE violation."""
    result = session.execute(
        select(models.PPEViolation).where(models.PPEViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    if not violation:
        raise HTTPException(status_code=404, detail="PPE violation not found")
    
    from datetime import datetime
    violation.resolved_at = datetime.utcnow()
    session.add(violation)
    session.commit()
    session.refresh(violation)
    return violation


@router.delete("/{violation_id}", status_code=204)
async def delete_ppe_violation(violation_id: int, session: Session = Depends(get_session)):
    """Delete a PPE violation."""
    result = session.execute(
        select(models.PPEViolation).where(models.PPEViolation.id == violation_id)
    )
    violation = result.scalar_one_or_none()
    if not violation:
        raise HTTPException(status_code=404, detail="PPE violation not found")
    session.delete(violation)
    session.commit()
    return None