from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["safety_issues"])


@router.get("/", response_model=List[schemas.SafetyIssueRead])
async def list_safety_issues(
    project_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """List safety issues, optionally filtered by project_id."""
    query = select(models.SafetyIssue)
    if project_id:
        query = query.where(models.SafetyIssue.project_id == project_id)
    result = session.execute(query.order_by(models.SafetyIssue.reported_at.desc()))
    issues = result.scalars().all()
    return issues


@router.post("/", response_model=schemas.SafetyIssueRead, status_code=201)
async def create_safety_issue(issue: schemas.SafetyIssueCreate, session: Session = Depends(get_session)):
    """Create a new safety issue."""
    # Verify project exists
    proj_result = session.execute(select(models.Project).where(models.Project.id == issue.project_id))
    proj = proj_result.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_issue = models.SafetyIssue(
        project_id=issue.project_id,
        title=issue.title,
        description=issue.description,
        category=issue.category,
        severity=issue.severity or "Medium",
    )
    session.add(db_issue)
    session.commit()
    session.refresh(db_issue)
    return db_issue


@router.get("/{issue_id}", response_model=schemas.SafetyIssueRead)
async def get_safety_issue(issue_id: int, session: Session = Depends(get_session)):
    """Get a single safety issue by ID."""
    result = session.execute(select(models.SafetyIssue).where(models.SafetyIssue.id == issue_id))
    issue = result.scalar_one_or_none()
    if not issue:
        raise HTTPException(status_code=404, detail="Safety issue not found")
    return issue


@router.put("/{issue_id}", response_model=schemas.SafetyIssueRead)
async def update_safety_issue(
    issue_id: int, 
    issue_update: schemas.SafetyIssueUpdate, 
    session: Session = Depends(get_session)
):
    """Update a safety issue."""
    result = session.execute(select(models.SafetyIssue).where(models.SafetyIssue.id == issue_id))
    issue = result.scalar_one_or_none()
    if not issue:
        raise HTTPException(status_code=404, detail="Safety issue not found")
    
    update_data = issue_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "resolved" and value is True:
            from datetime import datetime
            issue.resolved_at = datetime.utcnow()
        else:
            setattr(issue, field, value)
    
    session.add(issue)
    session.commit()
    session.refresh(issue)
    return issue


@router.delete("/{issue_id}", status_code=204)
async def delete_safety_issue(issue_id: int, session: Session = Depends(get_session)):
    """Delete a safety issue."""
    result = session.execute(select(models.SafetyIssue).where(models.SafetyIssue.id == issue_id))
    issue = result.scalar_one_or_none()
    if not issue:
        raise HTTPException(status_code=404, detail="Safety issue not found")
    session.delete(issue)
    session.commit()
    return None