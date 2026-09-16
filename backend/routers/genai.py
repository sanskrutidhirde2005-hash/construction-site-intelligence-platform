from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List, Optional
from datetime import datetime

from .. import models, schemas
from ..database import get_session


router = APIRouter(tags=["genai"])


@router.post("/query", response_model=schemas.GenAIQueryRead)
async def genai_query(query: schemas.GenAIQueryCreate, session: Session = Depends(get_session)):
    """Process a GenAI query and return a response."""
    # Verify project exists if project_id provided
    if query.project_id:
        proj_result = session.execute(
            select(models.Project).where(models.Project.id == query.project_id)
        )
        proj = proj_result.scalar_one_or_none()
        if not proj:
            raise HTTPException(status_code=404, detail="Project not found")
    
    # Create the query record
    db_query = models.GenAIQuery(
        query_text=query.query_text,
        project_id=query.project_id,
    )
    session.add(db_query)
    session.commit()
    session.refresh(db_query)
    
    # Generate a response based on the query using project data
    response_text = _generate_answer(query.query_text, project_id=query.project_id, session=session)
    
    # Update the query with the response
    db_query.response_text = response_text
    session.add(db_query)
    session.commit()
    session.refresh(db_query)
    
    return db_query


def _generate_answer(query_text: str, project_id: Optional[int] = None, session=None) -> str:
    """Generate a response to a GenAI query based on project data."""
    if session is None:
        from ..database import get_session
        session = get_session()
    
    q = query_text.lower()
    
    # If we have a project_id, fetch relevant data
    if project_id:
        # Get project info
        proj_result = session.execute(
            select(models.Project).where(models.Project.id == project_id)
        )
        proj = proj_result.scalar_one_or_none()
        
        if proj:
            # Get related data
            from sqlalchemy import func
            
            # Count inspections
            ins_result = session.execute(
                select(models.Inspection).where(models.Inspection.project_id == project_id)
            )
            inspections = ins_result.scalars().all()
            
            # Count safety issues
            saf_result = session.execute(
                select(models.SafetyIssue).where(models.SafetyIssue.project_id == project_id)
            )
            safety_issues = saf_result.scalars().all()
            
            # Count materials
            mat_result = session.execute(
                select(models.Material).where(models.Material.project_id == project_id)
            )
            materials = mat_result.scalars().all()
            
            # Count risks
            risk_result = session.execute(
                select(models.Risk).where(models.Risk.project_id == project_id)
            )
            risks = risk_result.scalars().all()
            
            # Build response
            lines = []
            
            if "progress" in q or "status" in q:
                lines.append(f"Project: {proj.name}")
                lines.append(f"Progress: {proj.progress}%")
                lines.append(f"Status: {proj.status}")
            
            if "risk" in q:
                high_risks = [r for r in risks if r.severity in ("High", "Critical")]
                lines.append(f"Total risks: {len(risks)}")
                if high_risks:
                    lines.append(f"High-priority risks: {len(high_risks)}")
            
            if "safety" in q or "ppe" in q:
                lines.append(f"Safety issues: {len(safety_issues)}")
                ppe_issues = [s for s in safety_issues if s.category == "PPE"]
                if ppe_issues:
                    lines.append(f"PPE-related issues: {len(ppe_issues)}")
            
            if "material" in q or "stock" in q:
                low_stock = [m for m in materials if m.current_stock <= m.minimum_stock]
                lines.append(f"Materials: {len(materials)}")
                if low_stock:
                    lines.append(f"Low stock materials: {len(low_stock)}")
                    for m in low_stock[:3]:
                        lines.append(f"  - {m.name}: {m.current_stock} {m.unit}")
            
            if "inspection" in q:
                lines.append(f"Inspections: {len(inspections)}")
                pending = [i for i in inspections if i.status == "Pending"]
                if pending:
                    lines.append(f"Pending inspections: {len(pending)}")
            
            if not lines:
                lines.append(f"Project: {proj.name}")
                lines.append(f"Overall progress: {proj.progress}%")
                lines.append(f"Status: {proj.status}")
                lines.append(f"Total risks: {len(risks)}")
                lines.append(f"Safety issues: {len(safety_issues)}")
                lines.append(f"Materials tracked: {len(materials)}")
                lines.append(f"Inspections: {len(inspections)}")
            
            return "\n".join(lines)
    
    # Default response without project context
    return """I can help you with information about your construction projects, including:
- Project progress and status
- Risk analysis and mitigation
- Safety issues and PPE compliance
- Material stock levels
- Inspection schedules and results

Please ask me about specific projects or provide more details about what you'd like to know."""