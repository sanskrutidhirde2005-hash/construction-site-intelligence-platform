from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
from decimal import Decimal

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["materials"])


@router.get("/", response_model=List[schemas.MaterialRead])
async def list_materials(
    project_id: Optional[int] = None,
    session: Session = Depends(get_session)
):
    """List materials, optionally filtered by project_id."""
    query = select(models.Material)
    if project_id:
        query = query.where(models.Material.project_id == project_id)
    result = session.execute(query.order_by(models.Material.name))
    materials = result.scalars().all()
    return materials


@router.post("/", response_model=schemas.MaterialRead, status_code=201)
async def create_material(material: schemas.MaterialCreate, session: Session = Depends(get_session)):
    """Create a new material entry."""
    # Verify project exists
    proj_result = session.execute(select(models.Project).where(models.Project.id == material.project_id))
    proj = proj_result.scalar_one_or_none()
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    
    db_material = models.Material(
        project_id=material.project_id,
        name=material.name,
        current_stock=material.current_stock,
        minimum_stock=material.minimum_stock,
        unit=material.unit or "units",
    )
    session.add(db_material)
    session.commit()
    session.refresh(db_material)
    return db_material


@router.get("/{material_id}", response_model=schemas.MaterialRead)
async def get_material(material_id: int, session: Session = Depends(get_session)):
    """Get a single material by ID."""
    result = session.execute(select(models.Material).where(models.Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return material


@router.put("/{material_id}", response_model=schemas.MaterialRead)
async def update_material(
    material_id: int, 
    material_update: schemas.MaterialUpdate, 
    session: Session = Depends(get_session)
):
    """Update material stock levels."""
    result = session.execute(select(models.Material).where(models.Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    update_data = material_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(material, field, value)
    
    session.add(material)
    session.commit()
    session.refresh(material)
    return material


@router.put("/{material_id}/restock", response_model=schemas.MaterialRead)
async def restock_material(
    material_id: int, 
    amount: float,
    session: Session = Depends(get_session)
):
    """Restock material by amount."""
    result = session.execute(select(models.Material).where(models.Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    material.current_stock += amount
    session.add(material)
    session.commit()
    session.refresh(material)
    return material


@router.delete("/{material_id}", status_code=204)
async def delete_material(material_id: int, session: Session = Depends(get_session)):
    """Delete a material."""
    result = session.execute(select(models.Material).where(models.Material.id == material_id))
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    session.delete(material)
    session.commit()
    return None