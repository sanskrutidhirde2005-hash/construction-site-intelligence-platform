from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import select, func
from typing import List, Optional
from datetime import datetime

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["projects"])


@router.get("/", response_model=List[schemas.ProjectRead])
async def list_projects(session: Session = Depends(get_session)):
    """List all projects."""
    result = session.execute(select(models.Project))
    projects = result.scalars().all()
    return projects


@router.post("/", response_model=schemas.ProjectRead, status_code=201)
async def create_project(project: schemas.ProjectCreate, session: Session = Depends(get_session)):
    """Create a new project."""
    db_project = models.Project(
        name=project.name,
        location=project.location,
        client=project.client,
        manager=project.manager,
    )
    session.add(db_project)
    session.commit()
    session.refresh(db_project)
    return db_project


@router.get("/{project_id}", response_model=schemas.ProjectRead)
async def get_project(project_id: int, session: Session = Depends(get_session)):
    """Get a single project by ID."""
    result = session.execute(select(models.Project).where(models.Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.put("/{project_id}", response_model=schemas.ProjectRead)
async def update_project(project_id: int, project_update: schemas.ProjectUpdate, session: Session = Depends(get_session)):
    """Update a project."""
    result = session.execute(select(models.Project).where(models.Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    
    update_data = project_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(project, field, value)
    
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: int, session: Session = Depends(get_session)):
    """Delete a project."""
    result = session.execute(select(models.Project).where(models.Project.id == project_id))
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    session.delete(project)
    session.commit()
    return None