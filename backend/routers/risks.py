from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["risks"])


@router.get("/", response_model=List[schemas.RiskRead])
async def list_risks(
    project_id: Optional[int] = None,
    severity: Optional[str] = None,
    session: Session = Depends(get_session)
):
    """List risks, optionally filtered by project_id and severity."""
    query = select(models.Risk)
    if project_id:
        query = query.where(models.Risk.project_id == project_id)
    if severity:
        query = query.where(models.Risk.severity == severity)
    result = session.execute(query.order_by(models.Risk.detected_at.desc()))
    risks = result.scalars().all()
    return risks


@router.post("/", response_model=schemas.RiskRead, status_code=201)
async def create_risk(risk: schemas.RiskCreate, session: Session = Depends(get_session)):
    """Create a new risk."""
    # Verify project exists
    proj_result = session.execute(select(models.Project).where(models.Project.id == risk.project_id))
    proj = proj_result.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_risk = models.Risk(
        project_id=risk.project_id,
        title=risk.title,
        description=risk.description,
        category=risk.category,
        severity=risk.severity or "Medium",
        mitigation_plan=risk.mitigation_plan,
    )
    session.add(db_risk)
    session.commit()
    session.refresh(db_risk)
    return db_risk


@router.get("/{risk_id}", response_model=schemas.RiskRead)
async def get_risk(risk_id: int, session: Session = Depends(get_session)):
    """Get a single risk by ID."""
    result = session.execute(select(models.Risk).where(models.Risk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    return risk


@router.put("/{risk_id}", response_model=schemas.RiskRead)
async def update_risk(
    risk_id: int, 
    risk_update: schemas.RiskUpdate, 
    session: Session = Depends(get_session)
):
    """Update a risk."""
    result = session.execute(select(models.Risk).where(models.Risk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    
    update_data = risk_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(risk, field, value)
    
    session.add(risk)
    session.commit()
    session.refresh(risk)
    return risk


@router.put("/{risk_id}/mitigate", response_model=schemas.RiskRead)
async def mitigate_risk(
    risk_id: int, 
    session: Session = Depends(get_session)
):
    """Mark a risk as mitigated."""
    result = session.execute(select(models.Risk).where(models.Risk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    
    risk.mitigation_plan = f"Mitigated on {datetime.utcnow().isoformat()}"
    session.add(risk)
    session.commit()
    session.refresh(risk)
    return risk


@router.delete("/{risk_id}", status_code=204)
async def delete_risk(risk_id: int, session: Session = Depends(get_session)):
    """Delete a risk."""
    result = session.execute(select(models.Risk).where(models.Risk.id == risk_id))
    risk = result.scalar_one_or_none()
    if not risk:
        raise HTTPException(status_code=404, detail="Risk not found")
    session.delete(risk)
    session.commit()
    return None