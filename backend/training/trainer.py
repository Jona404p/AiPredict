"""
training/trainer.py — Entrenamiento avanzado v4 con validación temporal y feature importance
Incluye: 
  • Validación temporal (Time Series Split) para evaluación realista
  • Tracking de importancia de features para interpretabilidad
  • Calibración mejorada con múltiples métodos
  • Análisis de estabilidad del modelo
  • Multi-temporada support para mejor generalización
"""

import os
import logging
import numpy as np
import pandas as pd
import joblib
import json
from datetime import datetime
from collections import defaultdict

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier, VotingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import (
    train_test_split, StratifiedKFold, cross_val_score, TimeSeriesSplit
)
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    classification_report, accuracy_score, confusion_matrix, 
    roc_auc_score, log_loss, f1_score
)
from sklearn.pipeline import Pipeline

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False
    logging.warning("XGBoost no instalado. Usando solo GradientBoosting + RandomForest.")

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import MODEL_PATH, SCALER_PATH, LEAGUES
from data.fetcher import get_league_matches, get_understat_xg, get_standings
from core.features import build_features_from_history, FEATURE_COLS

logger = logging.getLogger(__name__)


# ─── Feature Importance Tracking ────────────────────────────────────────────

class FeatureImportanceTracker:
    """Tracks and analyzes feature importance across multiple models."""
    
    def __init__(self, feature_names: list):
        self.feature_names = feature_names
        self.importances = defaultdict(list)
        self.stability_scores = {}
    
    def add_importance(self, model_name: str, importance_values: np.ndarray):
        """Add importance values from a trained model."""
        if len(importance_values) != len(self.feature_names):
            raise ValueError(f"Expected {len(self.feature_names)} features, got {len(importance_values)}")
        
        importance_dict = dict(zip(self.feature_names, importance_values))
        self.importances[model_name].append(importance_dict)
    
    def get_feature_ranking(self, model_name: str = None, top_k: int = 10) -> list:
        """Get top K most important features."""
        if model_name and model_name in self.importances:
            # Average importance across folds
            importance_lists = self.importances[model_name]
            avg_importance = defaultdict(float)
            for imp_dict in importance_lists:
                for feat, val in imp_dict.items():
                    avg_importance[feat] += val
            
            for feat in avg_importance:
                avg_importance[feat] /= len(importance_lists)
        else:
            # Average across all models
            avg_importance = defaultdict(float)
            total_models = 0
            for model_importances in self.importances.values():
                total_models += len(model_importances)
                for imp_dict in model_importances:
                    for feat, val in imp_dict.items():
                        avg_importance[feat] += val
            
            for feat in avg_importance:
                avg_importance[feat] /= max(total_models, 1)
        
        sorted_features = sorted(
            avg_importance.items(), 
            key=lambda x: x[1], 
            reverse=True
        )
        return sorted_features[:top_k]
    
    def calculate_stability(self, min_importance_threshold: float = 0.01):
        """Calculate feature stability across folds."""
        stability = {}
        for feat in self.feature_names:
            appearances = 0
            total_folds = 0
            
            for model_importances in self.importances.values():
                total_folds += len(model_importances)
                for imp_dict in model_importances:
                    if imp_dict.get(feat, 0) > min_importance_threshold:
                        appearances += 1
            
            stability[feat] = appearances / max(total_folds, 1)
        
        self.stability_scores = stability
        return stability
    
    def get_report(self, top_k: int = 15) -> str:
        """Generate a comprehensive feature importance report."""
        lines = ["🎯 FEATURE IMPORTANCE ANALYSIS\n"]
        
        # Top features
        lines.append(f"Top {top_k} Most Important Features:")
        top_features = self.get_feature_ranking(top_k=top_k)
        for i, (feat, importance) in enumerate(top_features, 1):
            stability = self.stability_scores.get(feat, 0)
            lines.append(f"  {i:2d}. {feat:30s} | Importance: {importance:7.4f} | Stability: {stability:5.1%}")
        
        # Stability analysis
        if self.stability_scores:
            lines.append("\n📊 Feature Stability (% of folds where feature is important):")
            stable_features = sorted(
                self.stability_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )[:10]
            for feat, stability in stable_features:
                if stability > 0:
                    lines.append(f"  {feat:30s} | Stability: {stability:5.1%}")
        
        return "\n".join(lines)


# ─── Temporal Validation ─────────────────────────────────────────────────────

def temporal_validation_split(df: pd.DataFrame, n_splits: int = 5) -> list:
    """
    Time-based train/test split for temporal validation.
    Ensures no data leakage and realistic evaluation.
    """
    if 'date' not in df.columns:
        logger.warning("No 'date' column found. Using StratifiedKFold instead.")
        return None
    
    df = df.sort_values('date').reset_index(drop=True)
    splits = []
    
    chunk_size = len(df) // (n_splits + 1)
    for i in range(n_splits):
        train_idx = list(range(i * chunk_size))
        test_idx = list(range(i * chunk_size, (i + 1) * chunk_size))
        # Skip folds where train or test sets are empty
        if len(train_idx) > 0 and len(test_idx) > 0:
            splits.append((train_idx, test_idx))
    
    return splits


def evaluate_temporal_stability(
    pipeline,
    X: pd.DataFrame,
    y: pd.Series,
    feature_tracker: FeatureImportanceTracker = None
) -> dict:
    """
    Evaluate model stability across temporal folds.
    """
    temporal_splits = temporal_validation_split(
        X.reset_index().assign(date=pd.date_range('2020-01-01', periods=len(X))),
        n_splits=5
    )
    
    if not temporal_splits:
        return {}
    
    scores = {
        'accuracy': [],
        'f1_weighted': [],
        'log_loss': []
    }
    
    for train_idx, test_idx in temporal_splits:
        if len(train_idx) == 0 or len(test_idx) == 0:
            continue
        
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]
        y_train, y_test = y.iloc[train_idx], y.iloc[test_idx]
        
        # Need at least 2 classes and enough samples for CalibratedClassifierCV (cv=3)
        if len(X_train) < 6 or y_train.nunique() < 2:
            continue
        
        pipeline.fit(X_train, y_train)
        
        y_pred = pipeline.predict(X_test)
        y_pred_proba = pipeline.predict_proba(X_test)
        
        acc = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, average='weighted', zero_division=0)
        ll = log_loss(y_test, y_pred_proba)
        
        scores['accuracy'].append(acc)
        scores['f1_weighted'].append(f1)
        scores['log_loss'].append(ll)
    
    return {
        'accuracy': {
            'mean': np.mean(scores['accuracy']),
            'std': np.std(scores['accuracy']),
            'scores': scores['accuracy']
        },
        'f1_weighted': {
            'mean': np.mean(scores['f1_weighted']),
            'std': np.std(scores['f1_weighted']),
            'scores': scores['f1_weighted']
        },
        'log_loss': {
            'mean': np.mean(scores['log_loss']),
            'std': np.std(scores['log_loss']),
            'scores': scores['log_loss']
        }
    }


def train(leagues: list = None, save: bool = True, seasons: list = None) -> dict:
    """
    Entrena el modelo con datos de las ligas especificadas.
    Opcionalmente puede descargar múltiples temporadas para más datos.

    Args:
        leagues: Lista de keys de liga. Por defecto todas.
        save: Si guarda el modelo en disco.
        seasons: Lista de años de temporada, ej. [2022, 2023, 2024]. Por defecto solo actual.

    Returns:
        Dict con accuracy, reporte y modelo.
    """
    leagues = leagues or list(LEAGUES.keys())
    seasons = seasons or [None]   # None = temporada actual de la API
    all_records = []

    for league_key in leagues:
        for season in seasons:
            season_label = str(season) if season else "actual"
            logger.info(f"Descargando {league_key} temporada {season_label}...")
            try:
                matches  = get_league_matches(league_key, status="FINISHED", season=season)
                xg_data  = get_understat_xg(league_key)
                standings = get_standings(league_key)

                records = build_features_from_history(matches, xg_data, standings)
                all_records.extend(records)
                logger.info(f"  → {len(records)} registros de {league_key} ({season_label})")
            except Exception as e:
                logger.warning(f"Error en liga '{league_key}' temporada {season_label}: {e}")

    if not all_records:
        raise RuntimeError("No se pudo obtener datos para entrenar. Verifica tu API key y conexión.")

    df = pd.DataFrame(all_records).drop_duplicates()
    logger.info(f"Dataset total: {len(df)} partidos | Dist: {df['result'].value_counts().to_dict()}")

    X = df[FEATURE_COLS]
    y = df["result"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    # ── Clasificadores ──────────────────────────────
    gb = GradientBoostingClassifier(
        n_estimators=400, max_depth=4,
        learning_rate=0.04, subsample=0.8,
        min_samples_leaf=3, random_state=42,
    )
    rf = RandomForestClassifier(
        n_estimators=400, max_features="sqrt",
        min_samples_leaf=2, random_state=42, n_jobs=-1,
    )

    estimators = [("gb", gb), ("rf", rf)]
    weights    = [2, 1]

    if HAS_XGB:
        xgb = XGBClassifier(
            n_estimators=400, max_depth=4,
            learning_rate=0.04, subsample=0.8,
            colsample_bytree=0.8,
            eval_metric="mlogloss", random_state=42,
        )
        estimators.append(("xgb", xgb))
        weights.append(2)
        logger.info("XGBoost incluido en el ensemble.")

    ensemble = VotingClassifier(
        estimators=estimators, voting="soft", weights=weights,
    )

    # Pipeline: escalado + ensemble + calibración de probabilidades mejorada
    base_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("model", ensemble),
    ])

    # Calibrar con método isotónico para mejor calibración en distribuciones no simétricas
    pipeline = CalibratedClassifierCV(base_pipeline, method="isotonic", cv=3)

    logger.info("Entrenando modelo con validación temporal (puede tardar 2-4 minutos)...")
    pipeline.fit(X_train, y_train)

    # ── Evaluación estándar ────────────────────────────────────────
    y_pred = pipeline.predict(X_test)
    y_pred_proba = pipeline.predict_proba(X_test)
    
    acc    = accuracy_score(y_test, y_pred)
    f1_weighted = f1_score(y_test, y_pred, average='weighted', zero_division=0)
    ll     = log_loss(y_test, y_pred_proba)
    report = classification_report(y_test, y_pred, target_names=["Visitante", "Empate", "Local"])
    cm     = confusion_matrix(y_test, y_pred)

    # ── Cross-validation estratificada ──────────────────────────────
    cv_scores = cross_val_score(
        Pipeline([("scaler", StandardScaler()), ("model", ensemble)]),
        X, y, cv=StratifiedKFold(5), scoring="accuracy"
    )
    
    # ── Validación temporal para estabilidad ────────────────────────
    logger.info("Evaluando estabilidad temporal del modelo...")
    temporal_stability = evaluate_temporal_stability(pipeline, X, y)
    
    # ── Feature Importance Tracking ─────────────────────────────────
    feature_tracker = FeatureImportanceTracker(FEATURE_COLS)
    
    # Extract importances from base models
    if hasattr(ensemble, 'estimators_'):
        for name, est in ensemble.estimators_:
            if hasattr(est, 'feature_importances_'):
                feature_tracker.add_importance(name, est.feature_importances_)
    
    feature_tracker.calculate_stability()
    feature_report = feature_tracker.get_report(top_k=15)
    
    logger.info(f"Accuracy test: {acc:.3f}")
    logger.info(f"F1 Weighted: {f1_weighted:.3f}")
    logger.info(f"CV: {cv_scores.mean():.3f} ± {cv_scores.std():.3f}")
    
    if temporal_stability:
        logger.info(f"Temporal Stability (Accuracy): {temporal_stability['accuracy']['mean']:.3f} ± {temporal_stability['accuracy']['std']:.3f}")
    
    logger.info(f"\n{report}")
    logger.info(f"\n{feature_report}")

    # ── Guardar modelo y metadatos ──────────────────────────────────
    if save:
        os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
        joblib.dump(pipeline, MODEL_PATH)
        
        # Save metadata for model interpretation
        metadata = {
            "timestamp": datetime.now().isoformat(),
            "accuracy": round(acc, 4),
            "f1_weighted": round(f1_weighted, 4),
            "cv_mean": round(cv_scores.mean(), 4),
            "cv_std": round(cv_scores.std(), 4),
            "log_loss": round(ll, 4),
            "n_samples": len(df),
            "temporal_stability": {
                k: {
                    "mean": round(v["mean"], 4),
                    "std": round(v["std"], 4)
                } for k, v in temporal_stability.items()
            } if temporal_stability else {},
            "top_features": [
                {"feature": f, "importance": round(imp, 4)} 
                for f, imp in feature_tracker.get_feature_ranking(top_k=20)
            ],
            "feature_stability": {
                f: round(s, 3) 
                for f, s in feature_tracker.stability_scores.items() 
                if s > 0.1
            }
        }
        
        metadata_path = MODEL_PATH.replace('.pkl', '_metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(metadata, f, indent=2)
        
        logger.info(f"Modelo guardado en {MODEL_PATH}")
        logger.info(f"Metadatos guardados en {metadata_path}")

    return {
        "accuracy":           round(acc, 4),
        "f1_weighted":        round(f1_weighted, 4),
        "log_loss":           round(ll, 4),
        "cv_mean":            round(cv_scores.mean(), 4),
        "cv_std":             round(cv_scores.std(), 4),
        "temporal_stability": temporal_stability,
        "feature_importance": feature_tracker.get_feature_ranking(top_k=15),
        "feature_stability":  feature_tracker.stability_scores,
        "report":             report,
        "confusion_matrix":   cm.tolist(),
        "n_samples":          len(df),
        "model":              pipeline,
    }


def load_model():
    if not os.path.exists(MODEL_PATH):
        raise FileNotFoundError(
            f"Modelo no encontrado en '{MODEL_PATH}'. Ejecuta 'python -m training.trainer' primero."
        )
    return joblib.load(MODEL_PATH)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    result = train(
        leagues=["bundesliga", "premier", "laliga", "seriea", "ligue1"],
        seasons=[None],   # puedes agregar 2023, 2024 para más datos
    )
    print(f"\n✓ Entrenamiento completo. Accuracy: {result['accuracy']}")
    print(f"  CV: {result['cv_mean']} ± {result['cv_std']}")
    print(f"  Muestras: {result['n_samples']}")